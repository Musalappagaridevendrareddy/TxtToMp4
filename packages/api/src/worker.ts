import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  parseVideoSpec,
  specHash,
  SpecValidationError,
  Timeline,
  type TypedVideoSpec,
} from '@explainer/spec';

import type { Attachment, Db, JobStatus } from './db.js';
import { isMainModule } from './migrate.js';
import type { Storage } from './storage.js';
import { videoKey } from './storage.js';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** A failure that retrying cannot fix — a bad spec, a cancelled job. */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    readonly stage: string,
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export class CancelledError extends NonRetryableError {
  constructor(stage: string) {
    super('job was cancelled', stage);
    this.name = 'CancelledError';
  }
}

export class StageTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`stage "${stage}" exceeded its ${Math.round(timeoutMs / 1000)}s budget and was killed`);
    this.name = 'StageTimeoutError';
  }
}

/* ------------------------------------------------------------------ *
 * Child processes
 * ------------------------------------------------------------------ */

export interface RunOptions {
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a binary with an argv array. There is deliberately no shell involved and
 * no code path in this file that concatenates a command string: the question is
 * untrusted input and must never be able to reach a shell.
 */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<CommandResult>;

export const runCommand: CommandRunner = async (file, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL', // hard kill: a hung manim render must not hold the worker
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      shell: false, // never true. see the note above.
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.killed) throw new StageTimeoutError(`${file} ${args[0] ?? ''}`.trim(), options.timeoutMs);
    const detail = (err.stderr ?? '').toString().trim().split('\n').slice(-20).join('\n');
    throw new Error(`${file} ${args.join(' ')} failed: ${err.message}${detail ? `\n${detail}` : ''}`);
  }
};

/** Timeout for in-process stages (Remotion), which have no child to kill. */
export async function withTimeout<T>(
  stage: string,
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StageTimeoutError(stage, timeoutMs)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Collaborating packages
 * ------------------------------------------------------------------ */

export interface CritiqueResult {
  approved: boolean;
  notes: string[];
  /** Raw revised spec; always re-validated before it is used. */
  revisedSpec?: unknown;
}

/** Text extracted from one uploaded file. Mirrors the ingest CLI's output. */
export interface Source {
  filename: string;
  kind: 'text' | 'pdf' | 'image' | 'unsupported';
  engine: string;
  text: string;
  truncated?: boolean;
  warnings?: string[];
}

export interface Planner {
  plan(input: { question: string; sources?: Source[] }): Promise<string>;
  emitSpec(input: {
    question: string;
    plan: string;
    feedback?: string[];
    sources?: Source[];
  }): Promise<unknown>;
  critique(input: {
    question: string;
    spec: TypedVideoSpec;
    keyframePaths: string[];
  }): Promise<CritiqueResult>;
}

export interface Compositor {
  renderExplainer(input: {
    specPath: string;
    timelinePath: string;
    assetsDir: string;
    outPath: string;
  }): Promise<string>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface PipelineDeps {
  db: Db;
  storage: Storage;
  planner: Planner;
  compositor: Compositor;
  run: CommandRunner;
  log: Logger;
  workDir: string;
  pythonBin: string;
  pythonRoot: string;
  ffmpegBin: string;
  ttsEngine: 'kokoro' | 'indextts2';
  kokoroVoice: string;
  whisperxDevice: string;
  whisperxModel: string;
  maxCritiqueIterations: number;
  maxSpecAttempts: number;
  timeouts: {
    narrationMs: number;
    manimMs: number;
    remotionMs: number;
    keyframeMs: number;
  };
}

export interface PipelineOutcome {
  jobId: string;
  videoUrl: string;
  specHash: string;
  iterations: number;
  /** True when an existing render for the same spec hash was reused. */
  cached: boolean;
}

/* ------------------------------------------------------------------ *
 * Pipeline
 * ------------------------------------------------------------------ */

/**
 * Run the ingest CLI over a job's uploads.
 *
 * Failure here is logged and swallowed by design: the question stands on its
 * own, so losing a source degrades the explanation rather than the request.
 * The one thing this must not do is let a bad upload take down an otherwise
 * valid render.
 */
export async function extractSources(
  jobId: string,
  attachments: Attachment[],
  jobDir: string,
  deps: Pick<PipelineDeps, 'run' | 'log' | 'pythonBin' | 'pythonRoot' | 'timeouts'>,
): Promise<Source[]> {
  if (attachments.length === 0) return [];

  const paths = attachments.map((a) => join(jobDir, a.path));

  try {
    const { stdout } = await deps.run(deps.pythonBin, ['-m', 'ingest.cli', ...paths], {
      cwd: jobDir,
      env: { ...process.env, PYTHONPATH: deps.pythonRoot },
      timeoutMs: deps.timeouts.narrationMs,
    });

    const sources = (JSON.parse(stdout) as { sources?: Source[] }).sources ?? [];

    for (const source of sources) {
      if (source.warnings?.length) {
        deps.log.warn({ jobId, file: source.filename, warnings: source.warnings }, 'ingest warning');
      }
    }
    deps.log.info(
      { jobId, read: sources.filter((s) => s.text).length, of: attachments.length },
      'sources extracted',
    );
    return sources;
  } catch (error) {
    deps.log.error({ jobId, err: error }, 'ingest failed; continuing from the question alone');
    return [];
  }
}

export async function runPipeline(
  input: { jobId: string; question: string },
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const { jobId, question } = input;
  const jobDir = join(deps.workDir, jobId);
  let stage: JobStatus = 'queued';
  let hash: string | null = null;

  /** A DELETE while the job is running only sets the status; we notice here. */
  const assertNotCancelled = async () => {
    const row = await deps.db.getJob(jobId);
    if (!row) throw new NonRetryableError(`job ${jobId} disappeared`, stage);
    if (row.status === 'cancelled') throw new CancelledError(stage);
  };

  /**
   * Moves the job to a stage and leaves a `renders` row so progress is
   * observable. The cancellation check lives HERE rather than at each call
   * site: writing the next status is exactly the operation that would otherwise
   * clobber a `cancelled` flag set by DELETE /jobs/:id, so the check and the
   * write have to be the same step.
   */
  const enter = async (next: JobStatus, artifactPath?: string) => {
    await assertNotCancelled();
    stage = next;
    await deps.db.updateJob(jobId, { status: next });
    await deps.db.recordRender({ jobId, stage: next, specHash: hash, artifactPath: artifactPath ?? null });
    deps.log.info({ jobId, stage: next, specHash: hash }, 'stage');
  };

  try {
    await mkdir(jobDir, { recursive: true });

    // 0. Uploads ----------------------------------------------------------
    // Extracted text travels with the question as evidence; it never replaces
    // it. A failed extraction is therefore not fatal — the question alone is
    // still a complete request.
    const jobRow = await deps.db.getJob(jobId);
    const sources = await extractSources(jobId, jobRow?.attachments ?? [], jobDir, deps);

    // 1. Plan -------------------------------------------------------------
    await enter('planning');
    const plan = await deps.planner.plan({ question, sources });
    await deps.db.updateJob(jobId, { plan });

    // 2. Spec, with the emitter's own validation feedback fed back in ------
    await enter('spec');
    let spec = await emitValidSpec({ question, plan, sources }, deps);
    hash = specHash(spec);
    await deps.db.updateJob(jobId, { spec, specHash: hash });
    await deps.db.recordRender({ jobId, stage: 'spec_accepted', specHash: hash, artifactPath: null });

    // 3. Spec-hash cache: an identical spec already has a video ------------
    const reusable = await deps.db.findCompletedBySpecHash(hash, jobId);
    if (reusable?.video_url) {
      await deps.db.recordRender({ jobId, stage: 'cache_hit', specHash: hash, artifactPath: reusable.video_url });
      await deps.db.updateJob(jobId, {
        status: 'completed',
        videoUrl: reusable.video_url,
        error: null,
      });
      deps.log.info({ jobId, specHash: hash, reusedFrom: reusable.id }, 'spec-hash cache hit');
      return { jobId, videoUrl: reusable.video_url, specHash: hash, iterations: 0, cached: true };
    }

    // 4. Render, then critique and re-render up to maxCritiqueIterations ---
    let iterations = 0;
    let artifacts = await renderOnce(spec, hash, iterations, { jobId, jobDir, enter }, deps);

    while (iterations < deps.maxCritiqueIterations) {
      await enter('critique');

      const verdict = await deps.planner.critique({
        question,
        spec,
        keyframePaths: artifacts.keyframePaths,
      });

      await deps.db.recordRender({
        jobId,
        stage: `critique_${iterations}_before`,
        specHash: hash,
        artifactPath: artifacts.videoPath,
      });

      if (verdict.approved || verdict.revisedSpec === undefined) {
        deps.log.info({ jobId, iterations, notes: verdict.notes }, 'critique approved');
        break;
      }

      let revised: TypedVideoSpec;
      try {
        revised = parseVideoSpec(verdict.revisedSpec);
      } catch (error) {
        // A critic that cannot produce a valid spec is not a reason to fail a
        // render we already have. Keep the current cut.
        deps.log.warn(
          { jobId, iterations, issues: (error as SpecValidationError).issues },
          'critique returned an invalid spec; keeping current render',
        );
        break;
      }

      const revisedHash = specHash(revised);
      if (revisedHash === hash) {
        deps.log.info({ jobId, iterations }, 'critique changed nothing; stopping');
        break;
      }

      iterations += 1;
      spec = revised;
      hash = revisedHash;
      await deps.db.updateJob(jobId, { spec, specHash: hash, iterations });
      await deps.db.recordRender({
        jobId,
        stage: `critique_${iterations}_after`,
        specHash: hash,
        artifactPath: null,
      });

      const reusableRevision = await deps.db.findCompletedBySpecHash(hash, jobId);
      if (reusableRevision?.video_url) {
        await deps.db.recordRender({ jobId, stage: 'cache_hit', specHash: hash, artifactPath: reusableRevision.video_url });
        await deps.db.updateJob(jobId, {
          status: 'completed',
          videoUrl: reusableRevision.video_url,
          error: null,
        });
        return { jobId, videoUrl: reusableRevision.video_url, specHash: hash, iterations, cached: true };
      }

      artifacts = await renderOnce(spec, hash, iterations, { jobId, jobDir, enter }, deps);
    }

    // 5. Upload -----------------------------------------------------------
    await enter('uploading', artifacts.videoPath);
    const key = videoKey(jobId, hash, artifacts.videoPath);
    const videoUrl = await deps.storage.uploadVideo(artifacts.videoPath, key);

    await deps.db.updateJob(jobId, {
      status: 'completed',
      videoUrl,
      iterations,
      error: null,
    });
    await deps.db.recordRender({ jobId, stage: 'completed', specHash: hash, artifactPath: videoUrl });
    deps.log.info({ jobId, specHash: hash, iterations, videoUrl }, 'render complete');

    return { jobId, videoUrl, specHash: hash, iterations, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof CancelledError;

    await deps.db.updateJob(jobId, {
      status: cancelled ? 'cancelled' : 'failed',
      error: `${stage}: ${message}`,
    });
    await deps.db.recordRender({
      jobId,
      stage: cancelled ? 'cancelled' : `failed:${stage}`,
      specHash: hash,
      artifactPath: null,
    });
    deps.log.error({ jobId, stage, err: message }, cancelled ? 'job cancelled' : 'job failed');
    throw error;
  }
}

interface StageContext {
  jobId: string;
  jobDir: string;
  /** Advances the job's stage; also the cancellation checkpoint. */
  enter(stage: JobStatus, artifactPath?: string): Promise<void>;
}

interface RenderArtifacts {
  videoPath: string;
  timelinePath: string;
  keyframePaths: string[];
}

/**
 * One full narration -> manim -> remotion -> keyframes pass for a given spec.
 *
 * The spec crosses the process boundary as a FILE PATH. Nothing derived from
 * the user's question is ever passed as an argv value.
 */
async function renderOnce(
  spec: TypedVideoSpec,
  hash: string,
  iteration: number,
  ctx: StageContext,
  deps: PipelineDeps,
): Promise<RenderArtifacts> {
  const iterDir = join(ctx.jobDir, `iter-${iteration}`);
  const beatsDir = join(iterDir, 'beats');
  const keyframesDir = join(iterDir, 'keyframes');
  await mkdir(beatsDir, { recursive: true });
  await mkdir(keyframesDir, { recursive: true });

  const specPath = join(iterDir, 'spec.json');
  const timelinePath = join(iterDir, 'timeline.json');
  const videoPath = join(iterDir, 'explainer.mp4');
  await writeFile(specPath, JSON.stringify(spec, null, 2), 'utf8');

  const pythonEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: deps.pythonRoot,
    PYTHONUNBUFFERED: '1',
    KOKORO_VOICE: deps.kokoroVoice,
  };

  // Narration + WhisperX alignment ---------------------------------------
  await ctx.enter('narration', specPath);
  await deps.run(
    deps.pythonBin,
    [
      '-m',
      'narration.synthesize',
      '--spec',
      specPath,
      '--out',
      iterDir,
      '--engine',
      deps.ttsEngine,
      '--device',
      deps.whisperxDevice,
    ],
    { cwd: deps.pythonRoot, timeoutMs: deps.timeouts.narrationMs, env: pythonEnv },
  );

  const timeline = Timeline.parse(JSON.parse(await readFile(timelinePath, 'utf8')));
  if (timeline.specHash !== hash) {
    throw new NonRetryableError(
      `narration produced a timeline for spec ${timeline.specHash}, expected ${hash}`,
      'narration',
    );
  }

  // Manim beat renders ----------------------------------------------------
  await ctx.enter('manim', beatsDir);
  const manimResult = await deps.run(
    deps.pythonBin,
    [
      '-m',
      'manim_scenes.render_beat',
      '--all',
      '--spec',
      specPath,
      '--timeline',
      timelinePath,
      '--out',
      beatsDir,
    ],
    { cwd: deps.pythonRoot, timeoutMs: deps.timeouts.manimMs, env: pythonEnv },
  );

  const manimOutput = JSON.parse(manimResult.stdout) as {
    ok: boolean;
    error?: string;
    beats: Array<{ beatId: string; path: string }>;
  };
  if (!manimOutput.ok) {
    throw new Error(`manim_scenes.render_beat failed: ${manimOutput.error}`);
  }

  for (const beat of manimOutput.beats) {
    await copyFile(beat.path, join(beatsDir, `${beat.beatId}.webm`));
  }

  // Remotion composite ----------------------------------------------------
  await ctx.enter('remotion', videoPath);
  await withTimeout('remotion', deps.timeouts.remotionMs, () =>
    deps.compositor.renderExplainer({ specPath, timelinePath, assetsDir: iterDir, outPath: videoPath }),
  );

  // Keyframes, one per beat, for the critic to look at --------------------
  await ctx.enter('keyframes', keyframesDir);
  const keyframePaths = await extractKeyframes(videoPath, keyframesDir, timeline, deps);

  return { videoPath, timelinePath, keyframePaths };
}

/**
 * Grabs the mid-point frame of every beat. A frame per beat is what the critic
 * needs: it shows what each animation actually settled on.
 */
export async function extractKeyframes(
  videoPath: string,
  outDir: string,
  timeline: { beats: { beatId: string; startSeconds: number; audioSeconds: number }[] },
  deps: Pick<PipelineDeps, 'run' | 'ffmpegBin' | 'timeouts'>,
): Promise<string[]> {
  const paths: string[] = [];
  for (const beat of timeline.beats) {
    const at = beat.startSeconds + beat.audioSeconds / 2;
    // beatId is schema-constrained to [a-z0-9_-], but it is still only ever an
    // argv element, never part of a command string.
    const outPath = join(outDir, `${beat.beatId}.jpg`);
    await deps.run(
      deps.ffmpegBin,
      ['-y', '-ss', at.toFixed(3), '-i', videoPath, '-frames:v', '1', '-q:v', '3', outPath],
      { timeoutMs: deps.timeouts.keyframeMs },
    );
    paths.push(outPath);
  }
  return paths;
}

/**
 * Asks the emitter for a spec, handing validation issues back on each retry.
 * After `maxSpecAttempts` failures the job is unrecoverable — retrying the
 * BullMQ job would only burn tokens on the same prompt.
 */
export async function emitValidSpec(
  input: { question: string; plan: string; sources?: Source[] },
  deps: Pick<PipelineDeps, 'planner' | 'maxSpecAttempts' | 'log'>,
): Promise<TypedVideoSpec> {
  let feedback: string[] | undefined;

  for (let attempt = 1; attempt <= deps.maxSpecAttempts; attempt += 1) {
    const raw = await deps.planner.emitSpec({ ...input, ...(feedback ? { feedback } : {}) });
    try {
      return parseVideoSpec(raw);
    } catch (error) {
      if (!(error instanceof SpecValidationError)) throw error;
      feedback = error.issues;
      deps.log.warn({ attempt, issues: error.issues }, 'spec rejected, retrying emitter');
    }
  }

  throw new NonRetryableError(
    `emitter produced an invalid spec ${deps.maxSpecAttempts} times: ${(feedback ?? []).join('; ')}`,
    'spec',
  );
}

/* ------------------------------------------------------------------ *
 * Adapters for the sibling packages
 * ------------------------------------------------------------------ */

/**
 * `@explainer/planner` and `@explainer/compositor` are loaded at call time
 * rather than imported at the top, so this module — and its tests — do not need
 * either package built, and the API server process never pulls in Remotion or
 * the Anthropic SDK just to serve a status request.
 *
 * The `Planner` and `Compositor` interfaces above are ports; the sibling
 * packages have their own natural signatures and these functions are the plugs.
 * Keep the translation here rather than bending either side to the other.
 */

interface PlannerModule {
  plan(question: string, options?: unknown): Promise<string>;
  emitSpec(
    question: string,
    planText: string,
    options?: { maxAttempts?: number; sources?: Source[] },
  ): Promise<{ spec: TypedVideoSpec; attempts: number; repairs: string[][] }>;
  critique(
    spec: TypedVideoSpec,
    keyframePaths: string[],
    options?: unknown,
  ): Promise<
    | { verdict: 'ship'; note: string; spec: TypedVideoSpec }
    | { verdict: 'revise'; spec: TypedVideoSpec; notes: string }
  >;
}

export async function loadPlanner(): Promise<Planner> {
  const mod = (await import('@explainer/planner' as string)) as unknown as PlannerModule;
  for (const fn of ['plan', 'emitSpec', 'critique'] as const) {
    if (typeof mod[fn] !== 'function') {
      throw new Error(`@explainer/planner does not export ${fn}()`);
    }
  }

  return {
    plan: ({ question, sources }) => mod.plan(question, sources ? { sources } : {}),

    // The planner owns its own repair loop, and it is the better one: it keeps
    // the rejected attempt in the transcript and hands the model the
    // validator's own words. Let it run that loop; the worker's outer retry
    // (maxSpecAttempts) then sits at 1 by default — see config.
    emitSpec: async ({ question, plan, sources }) =>
      (await mod.emitSpec(question, plan, sources ? { sources } : {})).spec,

    critique: async ({ spec, keyframePaths }) => {
      const outcome = await mod.critique(spec, keyframePaths);
      return outcome.verdict === 'ship'
        ? { approved: true, notes: [outcome.note] }
        : { approved: false, notes: [outcome.notes], revisedSpec: outcome.spec };
    },
  };
}

interface CompositorModule {
  renderExplainer(input: {
    specPath: string;
    timelinePath: string;
    beatsDir: string;
    audioPath: string;
    outPath: string;
  }): Promise<{ outPath: string; durationInFrames: number; fps: number }>;
}

export async function loadCompositor(): Promise<Compositor> {
  const mod = (await import('@explainer/compositor' as string)) as unknown as CompositorModule;
  if (typeof mod.renderExplainer !== 'function') {
    throw new Error('@explainer/compositor does not export renderExplainer()');
  }

  return {
    renderExplainer: async ({ specPath, timelinePath, assetsDir, outPath }) => {
      const result = await mod.renderExplainer({
        specPath,
        timelinePath,
        beatsDir: join(assetsDir, 'beats'),
        audioPath: join(assetsDir, 'narration.wav'),
        outPath,
      });
      return result.outPath;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

if (isMainModule(import.meta.url)) {
  const [{ Worker, UnrecoverableError }, { getConfig }, { createDb, createPool }, { createStorage }, { createRedis, RENDER_QUEUE }, pinoMod] =
    await Promise.all([
      import('bullmq'),
      import('./config.js'),
      import('./db.js'),
      import('./storage.js'),
      import('./queue.js'),
      import('pino'),
    ]);

  const config = getConfig();
  const log = pinoMod.default({ level: config.logLevel, name: 'worker' });
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  const connection = createRedis(config.redisUrl);
  const storage = createStorage(config.s3);

  const deps: PipelineDeps = {
    db,
    storage,
    planner: await loadPlanner(),
    compositor: await loadCompositor(),
    run: runCommand,
    log,
    workDir: config.renderWorkDir,
    pythonBin: config.pythonBin,
    pythonRoot: config.pythonRoot,
    ffmpegBin: config.ffmpegBin,
    ttsEngine: config.tts.engine,
    kokoroVoice: config.tts.kokoroVoice,
    whisperxDevice: config.whisperx.device,
    whisperxModel: config.whisperx.model,
    maxCritiqueIterations: config.maxCritiqueIterations,
    maxSpecAttempts: config.maxSpecAttempts,
    timeouts: config.timeouts,
  };

  const worker = new Worker<{ jobId: string; question: string }>(
    RENDER_QUEUE,
    async (job) => {
      try {
        await runPipeline({ jobId: job.data.jobId, question: job.data.question }, deps);
      } catch (error) {
        if (error instanceof NonRetryableError) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    },
    { connection, concurrency: config.workerConcurrency, lockDuration: 120_000 },
  );

  worker.on('failed', (job, error) => log.error({ jobId: job?.data?.jobId, err: error.message }, 'job failed'));
  log.info({ queue: RENDER_QUEUE, concurrency: config.workerConcurrency }, 'worker up');

  const shutdown = async () => {
    log.info({}, 'worker shutting down');
    await worker.close();
    await connection.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
