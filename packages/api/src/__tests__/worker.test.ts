import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { specHash } from '@explainer/spec';

import type { Storage } from '../storage.js';
import {
  NonRetryableError,
  runPipeline,
  type CommandResult,
  type CommandRunner,
  type PipelineDeps,
  type RunOptions,
} from '../worker.js';
import { createFakeDb, makeJobRow, validSpec, validTimeline, type FakeDb } from './fakes.js';

const QUESTION = 'How does a packet reach a server?';

interface Invocation {
  file: string;
  args: readonly string[];
  options: RunOptions;
}

interface Rig {
  deps: PipelineDeps;
  db: FakeDb;
  calls: Invocation[];
  uploads: { localPath: string; key: string }[];
  critiques: number;
  workDir: string;
}

/**
 * A pipeline wired to fakes. The only real I/O is the temp work directory,
 * because the pipeline genuinely writes the spec to disk and reads the
 * timeline back — that hand-off is part of what is under test.
 */
async function rig(
  overrides: {
    db?: FakeDb;
    emitSpec?: PipelineDeps['planner']['emitSpec'];
    critique?: PipelineDeps['planner']['critique'];
    run?: CommandRunner;
    maxCritiqueIterations?: number;
    maxSpecAttempts?: number;
  } = {},
): Promise<Rig> {
  const workDir = await mkdtemp(join(tmpdir(), 'explainer-worker-'));
  const db = overrides.db ?? createFakeDb();
  const calls: Invocation[] = [];
  const uploads: { localPath: string; key: string }[] = [];
  const rigState = { critiques: 0 };

  /** Stands in for python/ffmpeg. Writes the timeline the real narration would. */
  const defaultRun: CommandRunner = async (file, args, options): Promise<CommandResult> => {
    calls.push({ file, args, options });

    if (args.includes('narration.synthesize')) {
      const specPath = args[args.indexOf('--spec') + 1]!;
      const timelinePath = args[args.indexOf('--timeline') + 1]!;
      const spec = JSON.parse(await readFile(specPath, 'utf8'));
      await writeFile(timelinePath, JSON.stringify(validTimeline(specHash(spec))), 'utf8');
    }
    return { stdout: '', stderr: '' };
  };

  const storage: Storage = {
    async uploadVideo(localPath, key) {
      uploads.push({ localPath, key });
      return `http://minio:9000/renders/${key}`;
    },
    async presignedGetUrl(key) {
      return `http://minio:9000/renders/${key}?signed=1`;
    },
    publicUrlFor(key) {
      return `http://minio:9000/renders/${key}`;
    },
    async ping() {},
  };

  const deps: PipelineDeps = {
    db,
    storage,
    planner: {
      async plan() {
        return 'plan: three beats, walkthrough arc';
      },
      emitSpec: overrides.emitSpec ?? (async () => validSpec()),
      critique:
        overrides.critique ??
        (async () => {
          rigState.critiques += 1;
          return { approved: true, notes: ['looks good'] };
        }),
    },
    compositor: {
      async renderExplainer({ outPath }) {
        return outPath;
      },
    },
    run: overrides.run ?? defaultRun,
    log: { info() {}, warn() {}, error() {} },
    workDir,
    pythonBin: 'python',
    pythonRoot: join(workDir, 'packages'),
    ffmpegBin: 'ffmpeg',
    ttsEngine: 'kokoro',
    kokoroVoice: 'af_heart',
    whisperxDevice: 'cpu',
    whisperxModel: 'base.en',
    maxCritiqueIterations: overrides.maxCritiqueIterations ?? 3,
    maxSpecAttempts: overrides.maxSpecAttempts ?? 3,
    timeouts: { narrationMs: 1000, manimMs: 1000, remotionMs: 1000, keyframeMs: 1000 },
  };

  return {
    deps,
    db,
    calls,
    uploads,
    workDir,
    get critiques() {
      return rigState.critiques;
    },
  };
}

async function seedJob(db: FakeDb, question = QUESTION) {
  return db.createJob({ question });
}

test('the happy path walks every stage in order and records each one', async (t) => {
  const { deps, db, calls, uploads, workDir } = await rig();
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  const outcome = await runPipeline({ jobId: job.id, question: QUESTION }, deps);

  assert.deepEqual(db.stages(job.id), [
    'planning',
    'spec',
    'spec_accepted',
    'narration',
    'manim',
    'remotion',
    'keyframes',
    'critique',
    'critique_0_before',
    'uploading',
    'completed',
  ]);

  const finished = await db.getJob(job.id);
  assert.equal(finished?.status, 'completed');
  assert.equal(finished?.video_url, outcome.videoUrl);
  assert.equal(finished?.spec_hash, outcome.specHash);
  assert.equal(finished?.error, null);
  assert.equal(finished?.plan, 'plan: three beats, walkthrough arc');
  assert.equal(outcome.cached, false);
  assert.equal(outcome.iterations, 0);

  // narration + manim + one ffmpeg per beat
  assert.equal(calls.filter((c) => c.args.includes('narration.synthesize')).length, 1);
  assert.equal(calls.filter((c) => c.args.includes('manim_scenes.render_beat')).length, 1);
  assert.equal(calls.filter((c) => c.file === 'ffmpeg').length, 4);

  assert.equal(uploads.length, 1);
  assert.match(uploads[0]!.key, new RegExp(`^videos/${job.id}/${outcome.specHash}\\.mp4$`));
});

test('every stage carries a hard timeout that the runner is told about', async (t) => {
  const { deps, db, calls, workDir } = await rig();
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  await runPipeline({ jobId: job.id, question: QUESTION }, deps);

  for (const call of calls) {
    assert.equal(typeof call.options.timeoutMs, 'number');
    assert.ok(call.options.timeoutMs > 0, `${call.file} ran without a timeout`);
  }
});

test('an identical spec hash reuses the finished video and skips rendering', async (t) => {
  const db = createFakeDb();
  const hash = specHash(validSpec());
  db.jobs.set(
    'seeded',
    makeJobRow({
      id: 'seeded',
      question: 'a different phrasing of the same question entirely',
      status: 'completed',
      spec_hash: hash,
      video_url: 'http://minio:9000/renders/videos/seeded/cached.mp4',
    }),
  );

  const { deps, calls, uploads, workDir } = await rig({ db });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  const outcome = await runPipeline({ jobId: job.id, question: QUESTION }, deps);

  assert.equal(outcome.cached, true);
  assert.equal(outcome.videoUrl, 'http://minio:9000/renders/videos/seeded/cached.mp4');
  assert.equal(calls.length, 0, 'a spec-hash hit must not shell out at all');
  assert.equal(uploads.length, 0, 'a spec-hash hit must not re-upload');
  assert.deepEqual(db.stages(job.id), ['planning', 'spec', 'spec_accepted', 'cache_hit']);
  assert.equal((await db.getJob(job.id))?.status, 'completed');
});

test('a stage failure records the stage that failed and marks the job failed', async (t) => {
  const run: CommandRunner = async (file, args, options) => {
    if (args.includes('manim_scenes.render_beat')) throw new Error('manim: cairo exploded');
    if (args.includes('narration.synthesize')) {
      const specPath = args[args.indexOf('--spec') + 1]!;
      const timelinePath = args[args.indexOf('--timeline') + 1]!;
      const spec = JSON.parse(await readFile(specPath, 'utf8'));
      await writeFile(timelinePath, JSON.stringify(validTimeline(specHash(spec))), 'utf8');
    }
    void file;
    void options;
    return { stdout: '', stderr: '' };
  };

  const { deps, db, workDir } = await rig({ run });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  await assert.rejects(() => runPipeline({ jobId: job.id, question: QUESTION }, deps), /cairo/);

  const failed = await db.getJob(job.id);
  assert.equal(failed?.status, 'failed');
  assert.match(failed?.error ?? '', /^manim: /, 'the error records which stage died');
  assert.ok(db.stages(job.id).includes('failed:manim'));
  assert.equal(failed?.video_url, null);
});

test('an emitter that never produces a valid spec is not retried forever', async (t) => {
  let attempts = 0;
  const { deps, db, workDir } = await rig({
    emitSpec: async () => {
      attempts += 1;
      return { topic: 'nonsense', beats: [] };
    },
    maxSpecAttempts: 3,
  });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  await assert.rejects(
    () => runPipeline({ jobId: job.id, question: QUESTION }, deps),
    (error: unknown) => {
      assert.ok(error instanceof NonRetryableError, 'must be non-retryable');
      assert.equal(error.stage, 'spec');
      return true;
    },
  );

  assert.equal(attempts, 3, 'exactly maxSpecAttempts tries, no more');
  assert.equal((await db.getJob(job.id))?.status, 'failed');
  assert.match((await db.getJob(job.id))?.error ?? '', /^spec: /);
});

test('the emitter is handed its own validation issues on retry', async (t) => {
  const feedbackSeen: (string[] | undefined)[] = [];
  const { deps, db, workDir } = await rig({
    emitSpec: async ({ feedback }) => {
      feedbackSeen.push(feedback);
      return feedbackSeen.length === 1 ? { topic: 'bad', beats: [] } : validSpec();
    },
  });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  await runPipeline({ jobId: job.id, question: QUESTION }, deps);

  assert.equal(feedbackSeen.length, 2);
  assert.equal(feedbackSeen[0], undefined, 'the first attempt has nothing to react to');
  assert.ok((feedbackSeen[1] ?? []).length > 0, 'the retry is told what was wrong');
});

test('the critique loop revises, re-renders and stops at the cap', async (t) => {
  let round = 0;
  const revised = validSpec('A deliberately different topic for the revision');

  const { deps, db, calls, workDir } = await rig({
    maxCritiqueIterations: 3,
    critique: async () => {
      round += 1;
      return round === 1
        ? { approved: false, notes: ['beat 2 is cluttered'], revisedSpec: revised }
        : { approved: true, notes: ['fixed'] };
    },
  });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  const outcome = await runPipeline({ jobId: job.id, question: QUESTION }, deps);

  assert.equal(outcome.iterations, 1);
  assert.equal(round, 2, 'critique runs again on the revised cut');
  assert.equal(calls.filter((c) => c.args.includes('manim_scenes.render_beat')).length, 2);

  const stages = db.stages(job.id);
  assert.ok(stages.includes('critique_0_before'), 'the pre-revision render is logged');
  assert.ok(stages.includes('critique_1_after'), 'the post-revision spec is logged');
  assert.equal(outcome.specHash, specHash(revised));
  assert.equal((await db.getJob(job.id))?.iterations, 1);
});

test('the critique loop never exceeds its iteration cap', async (t) => {
  let n = 0;
  const { deps, db, workDir } = await rig({
    maxCritiqueIterations: 3,
    // A critic that is never happy, and always has a genuinely new spec.
    critique: async () => {
      n += 1;
      return {
        approved: false,
        notes: [`still wrong, round ${n}`],
        revisedSpec: validSpec(`Revision number ${n} of this explainer`),
      };
    },
  });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  const outcome = await runPipeline({ jobId: job.id, question: QUESTION }, deps);

  assert.equal(outcome.iterations, 3, 'capped at maxCritiqueIterations');
  assert.equal(n, 3);
  assert.equal((await db.getJob(job.id))?.status, 'completed');
});

test('a cancelled job stops between stages instead of finishing', async (t) => {
  const db = createFakeDb();
  const { deps, workDir, uploads } = await rig({ db });
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await seedJob(db);
  const originalPlan = deps.planner.plan;
  deps.planner.plan = async (input) => {
    const plan = await originalPlan(input);
    await db.updateJob(job.id, { status: 'cancelled' }); // a DELETE lands mid-flight
    return plan;
  };

  await assert.rejects(
    () => runPipeline({ jobId: job.id, question: QUESTION }, deps),
    /cancelled/,
  );

  assert.equal((await db.getJob(job.id))?.status, 'cancelled');
  assert.equal(uploads.length, 0);
});

/* ------------------------------------------------------------------ *
 * Untrusted input
 * ------------------------------------------------------------------ */

const HOSTILE = 'How does TLS work?"; rm -rf / #$(whoami) `id` && curl evil.test';

test('the question never reaches a child process, as an argument or otherwise', async (t) => {
  const { deps, db, calls, workDir } = await rig();
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const job = await db.createJob({ question: HOSTILE });
  await runPipeline({ jobId: job.id, question: HOSTILE }, deps);

  assert.ok(calls.length > 0, 'the pipeline did shell out, so the assertions below mean something');

  const fragments = ['rm -rf', 'whoami', 'curl', 'evil.test', 'TLS', '$(', '`', '&&', ';'];
  for (const call of calls) {
    for (const arg of [call.file, ...call.args]) {
      for (const fragment of fragments) {
        assert.equal(
          arg.includes(fragment),
          false,
          `argument ${JSON.stringify(arg)} carries ${JSON.stringify(fragment)} from the question`,
        );
      }
    }
    // Nothing is ever handed over as one pre-joined string.
    assert.ok(Array.isArray(call.args), 'arguments must stay an array');
    assert.equal(
      Object.prototype.hasOwnProperty.call(call.options, 'shell'),
      false,
      'no stage may ask for a shell',
    );
  }

  // The spec crosses the boundary as a file path, and that file exists.
  const specArg = calls.find((c) => c.args.includes('--spec'))!;
  const specPath = specArg.args[specArg.args.indexOf('--spec') + 1]!;
  assert.match(specPath, /spec\.json$/);
  const written = JSON.parse(await readFile(specPath, 'utf8'));
  assert.equal(typeof written.topic, 'string');
});

test('worker.ts contains no shell-string execution primitives', async () => {
  const source = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'worker.ts'),
    'utf8',
  );

  // `execFile` is the only sanctioned entry point.
  assert.match(source, /from 'node:child_process'/);
  assert.match(source, /import \{ execFile \} from 'node:child_process'/);

  for (const banned of [
    /\bexecSync\s*\(/,
    /\bspawnSync\s*\(/,
    /(^|[^A-Za-z])exec\s*\(/m, // bare exec(), not execFile()
    /shell\s*:\s*true/,
    /shell\s*:\s*['"`]/, // shell: '/bin/sh'
  ]) {
    assert.equal(banned.test(source), false, `worker.ts must not use ${banned}`);
  }

  // And the runner nails the option shut rather than relying on the default.
  assert.match(source, /shell:\s*false/);
});
