#!/usr/bin/env node
/**
 * End-to-end render without the service. This is the Phase 0-5 workhorse: it
 * runs the same stages the BullMQ worker runs, but in one process, against a
 * spec file on disk, with no Postgres, Redis or S3.
 *
 *   node scripts/render.mjs --spec fixtures/hashmap.json
 *   node scripts/render.mjs --spec fixtures/hashmap.json --dry-run
 *   node scripts/render.mjs --question "How does a hash map work?"
 *
 * Stages can be skipped when you only want part of the pipeline:
 *   --skip narration,manim,compositor
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const STAGE_TIMEOUTS_MS = {
  narration: 10 * 60_000,
  manim: 30 * 60_000,
  compositor: 30 * 60_000,
};

function parseArgs(argv) {
  const args = { skip: new Set(), dryRun: false, engine: 'kokoro', fps: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--spec':
        args.spec = value;
        i += 1;
        break;
      case '--question':
        args.question = value;
        i += 1;
        break;
      case '--out':
        args.out = value;
        i += 1;
        break;
      case '--engine':
        args.engine = value;
        i += 1;
        break;
      case '--fps':
        args.fps = Number(value);
        i += 1;
        break;
      case '--skip':
        for (const s of (value ?? '').split(',')) args.skip.add(s.trim());
        i += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
        args.help = true;
        break;
      default:
        if (flag?.startsWith('--')) throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function log(stage, message) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${stage.padEnd(10)} ${message}`);
}

async function stage(name, skip, fn) {
  if (skip.has(name)) {
    log(name, 'skipped');
    return undefined;
  }
  const started = Date.now();
  try {
    const result = await fn();
    log(name, `done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return result;
  } catch (error) {
    log(name, 'FAILED');
    if (error.stdout) console.error(String(error.stdout).slice(-4000));
    if (error.stderr) console.error(String(error.stderr).slice(-4000));
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.spec && !args.question)) {
    const usage = readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 14)
      .join('\n');
    console.log(usage);
    process.exit(args.help ? 0 : 1);
  }

  const specModule = join(root, 'packages', 'spec', 'dist', 'index.js');
  if (!existsSync(specModule)) {
    throw new Error('packages/spec is not built. Run: npm run build --workspace @explainer/spec');
  }
  const { parseVideoSpec, specHash, SpecValidationError } = await import(
    pathToFileURL(specModule).href
  );

  // 1. Get a spec: either read one, or ask Claude for one.
  let spec;
  if (args.spec) {
    const raw = JSON.parse(readFileSync(resolve(args.spec), 'utf8'));
    try {
      spec = parseVideoSpec(raw);
    } catch (error) {
      if (error instanceof SpecValidationError) {
        console.error(`${args.spec} is not a valid spec:`);
        for (const issue of error.issues) console.error(`  - ${issue}`);
        process.exit(1);
      }
      throw error;
    }
    log('spec', `${args.spec}: ${spec.beats.length} beats`);
  } else {
    const plannerModule = join(root, 'packages', 'planner', 'dist', 'index.js');
    if (!existsSync(plannerModule)) {
      throw new Error(
        'packages/planner is not built. Run: npm run build --workspace @explainer/planner',
      );
    }
    const { gate, plan, emitSpec } = await import(pathToFileURL(plannerModule).href);

    const verdict = await stage('gate', args.skip, () => gate(args.question));
    if (verdict && !verdict.suitable) {
      console.error(`Not a good fit for an explainer: ${verdict.reason}`);
      process.exit(2);
    }
    const planText = await stage('plan', args.skip, () => plan(args.question));
    const emitted = await stage('emit', args.skip, () => emitSpec(args.question, planText));
    spec = emitted.spec;
    log('emit', `${spec.beats.length} beats after ${emitted.attempts} attempt(s)`);
  }

  const hash = specHash(spec);
  const outDir = resolve(args.out ?? join(root, 'renders', hash));
  mkdirSync(join(outDir, 'beats'), { recursive: true });
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  log('spec', `hash ${hash} -> ${outDir}`);

  // 2. Narration + word-level timeline.
  await stage('narration', args.skip, () =>
    run(
      'python',
      [
        '-m',
        'narration.synthesize',
        '--spec',
        specPath,
        '--out',
        outDir,
        '--engine',
        args.engine,
        '--fps',
        String(args.fps),
        '--spec-hash',
        hash,
        ...(args.dryRun ? ['--dry-run'] : []),
      ],
      { cwd: join(root, 'packages', 'narration'), timeout: STAGE_TIMEOUTS_MS.narration },
    ),
  );

  const timelinePath = join(outDir, 'timeline.json');

  // 3. One transparent WebM per beat.
  await stage('manim', args.skip, () =>
    run(
      'python',
      [
        '-m',
        'manim_scenes.render_beat',
        '--spec',
        specPath,
        '--all',
        '--out',
        join(outDir, 'beats'),
        ...(existsSync(timelinePath) ? ['--timeline', timelinePath] : []),
      ],
      { cwd: join(root, 'packages', 'manim-scenes'), timeout: STAGE_TIMEOUTS_MS.manim },
    ),
  );

  // 4. Composite to MP4.
  const videoPath = join(outDir, 'explainer.mp4');
  await stage('compositor', args.skip, () =>
    run(
      'node',
      [
        join(root, 'packages', 'compositor', 'dist', 'render.js'),
        '--spec',
        specPath,
        '--timeline',
        timelinePath,
        '--beats',
        join(outDir, 'beats'),
        '--audio',
        join(outDir, 'narration.wav'),
        '--out',
        videoPath,
      ],
      { cwd: root, timeout: STAGE_TIMEOUTS_MS.compositor },
    ),
  );

  console.log(`\n${videoPath}`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
