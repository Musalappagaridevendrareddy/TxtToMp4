import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

import {
  ExplainerPropsSchema,
  SpecSummarySchema,
  TimelineSchema,
  type ExplainerProps,
} from './lib/props';
import { buildFramePlan } from './lib/frames';

export const COMPOSITION_ID = 'Explainer';

export interface RenderExplainerOptions {
  /** `spec.json` produced by the planner. */
  specPath: string;
  /** `timeline.json` produced by the narration stage. */
  timelinePath: string;
  /** Directory holding one `<beatId>.webm` per beat. */
  beatsDir: string;
  /** Concatenated narration wav. */
  audioPath: string;
  /** Where the finished mp4 goes. */
  outPath: string;
  /**
   * Remotion public directory. Beats and audio must live underneath it; it
   * defaults to the deepest directory containing both, which for the standard
   * `renders/<id>/{beats,narration.wav}` layout is `renders/<id>`.
   */
  publicDir?: string;
  /** Small uppercase label on the title and end cards. */
  kicker?: string;
  onProgress?: (progress: number) => void;
}

export interface RenderExplainerResult {
  outPath: string;
  durationInFrames: number;
  fps: number;
}

const DEFAULT_KICKER = 'An explainer';

/** Deepest directory that contains all of `targets`. */
function commonDirectory(targets: string[]): string {
  const split = targets.map((target) => path.resolve(target).split(path.sep));
  const first = split[0];
  if (first === undefined) {
    throw new Error('commonDirectory requires at least one path');
  }

  const shared: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const segment = first[i]!;
    if (split.every((parts) => parts[i] === segment)) {
      shared.push(segment);
    } else {
      break;
    }
  }
  const joined = shared.join(path.sep);
  return joined.length === 0 ? path.sep : joined;
}

/** Path of `target` relative to `root`, rejecting anything that escapes it. */
function insideOrThrow(root: string, target: string, label: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `${label} (${target}) is not inside the Remotion public directory (${root}). ` +
        'Pass an explicit `publicDir` that contains both the beats and the narration.',
    );
  }
  return relative.split(path.sep).join('/');
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Build the composition props from the on-disk artefacts.
 *
 * Everything crossing this boundary is untrusted -- the spec came out of a
 * model and the timeline out of a Python worker -- so both are parsed, not cast.
 */
export async function buildExplainerProps(
  options: RenderExplainerOptions,
): Promise<{ props: ExplainerProps; publicDir: string }> {
  const [specJson, timelineJson] = await Promise.all([
    readJson(options.specPath),
    readJson(options.timelinePath),
  ]);

  const spec = SpecSummarySchema.parse(specJson);
  const timeline = TimelineSchema.parse(timelineJson);

  const publicDir =
    options.publicDir ?? commonDirectory([options.beatsDir, path.dirname(options.audioPath)]);

  const props = ExplainerPropsSchema.parse({
    spec,
    timeline,
    assets: {
      beatsDir: insideOrThrow(publicDir, options.beatsDir, 'beatsDir'),
      audio: insideOrThrow(publicDir, options.audioPath, 'audioPath'),
    },
    kicker: options.kicker ?? DEFAULT_KICKER,
  } satisfies ExplainerProps);

  return { props, publicDir: path.resolve(publicDir) };
}

/** Render the finished explainer. This is what the API worker calls. */
export async function renderExplainer(
  options: RenderExplainerOptions,
): Promise<RenderExplainerResult> {
  const { props, publicDir } = await buildExplainerProps(options);

  const serveUrl = await bundle({
    entryPoint: path.resolve(__dirname, '..', 'src', 'index.ts'),
    publicDir,
  });

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: props,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 16,
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    jpegQuality: 95,
    overwrite: true,
    outputLocation: options.outPath,
    inputProps: props,
    onProgress: options.onProgress
      ? (update) => options.onProgress?.(update.progress)
      : undefined,
  });

  const plan = buildFramePlan(props.timeline);
  return {
    outPath: path.resolve(options.outPath),
    durationInFrames: plan.totalFrames,
    fps: props.timeline.fps,
  };
}

/* ------------------------------- CLI wrapper ------------------------------ */

const FLAGS = [
  'spec',
  'timeline',
  'beats',
  'audio',
  'out',
  'public-dir',
  'kicker',
] as const;
type Flag = (typeof FLAGS)[number];

function parseArgs(argv: string[]): Partial<Record<Flag, string>> {
  const parsed: Partial<Record<Flag, string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      continue;
    }
    const [rawName, inlineValue] = token.slice(2).split('=', 2);
    const name = rawName as Flag;
    if (!FLAGS.includes(name)) {
      throw new Error(`unknown flag --${rawName}`);
    }
    const value = inlineValue ?? argv[++i];
    if (value === undefined) {
      throw new Error(`--${name} needs a value`);
    }
    parsed[name] = value;
  }
  return parsed;
}

const USAGE = `Usage: node dist/render.js \\
  --spec <spec.json> --timeline <timeline.json> \\
  --beats <beatsDir> --audio <narration.wav> --out <out.mp4> \\
  [--public-dir <dir>] [--kicker "An explainer"]`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const required: Flag[] = ['spec', 'timeline', 'beats', 'audio', 'out'];
  const missing = required.filter((flag) => args[flag] === undefined);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.map((f) => `--${f}`).join(', ')}\n\n${USAGE}`);
  }

  const result = await renderExplainer({
    specPath: args.spec!,
    timelinePath: args.timeline!,
    beatsDir: args.beats!,
    audioPath: args.audio!,
    outPath: args.out!,
    publicDir: args['public-dir'],
    kicker: args.kicker,
    onProgress: (progress) => {
      process.stderr.write(`\rrender ${Math.round(progress * 100)}%`);
    },
  });

  process.stderr.write('\n');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
}
