import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Env loading and validation.
 *
 * Everything downstream reads `config`, never `process.env`, so a missing or
 * malformed variable fails once at boot with a readable list rather than as a
 * `undefined` deep inside the render pipeline half an hour later.
 */

/** Repo root, resolved from this file's compiled location (`packages/api/dist/config.js`). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MINUTE = 60_000;

const nonEmpty = (what: string) => z.string().min(1, `must not be empty (${what})`);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGIN: z.string().min(1).default('*'),

  // Claude API
  ANTHROPIC_API_KEY: nonEmpty('your Anthropic API key'),
  PLANNER_MODEL: z.string().min(1).default('claude-opus-5'),
  SPEC_MODEL: z.string().min(1).default('claude-opus-5'),
  CRITIQUE_MODEL: z.string().min(1).default('claude-sonnet-5'),
  GATE_MODEL: z.string().min(1).default('claude-haiku-4-5'),

  // Narration
  TTS_ENGINE: z.enum(['kokoro', 'indextts2']).default('kokoro'),
  KOKORO_VOICE: z.string().min(1).default('af_heart'),
  INDEXTTS2_MODEL_DIR: z.string().min(1).optional(),
  WHISPERX_DEVICE: z.string().min(1).default('cpu'),
  WHISPERX_MODEL: z.string().min(1).default('base.en'),

  // Infra
  DATABASE_URL: nonEmpty('postgres connection string').startsWith(
    'postgres',
    'must be a postgres:// or postgresql:// URL',
  ),
  REDIS_URL: nonEmpty('redis connection string').startsWith(
    'redis',
    'must be a redis:// or rediss:// URL',
  ),
  S3_ENDPOINT: nonEmpty('S3/MinIO endpoint').url('must be a URL, e.g. http://localhost:9000'),
  S3_ACCESS_KEY: nonEmpty('S3 access key'),
  S3_SECRET_KEY: nonEmpty('S3 secret key'),
  S3_BUCKET: nonEmpty('S3 bucket name'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** Public base URL for rendered videos, when it differs from S3_ENDPOINT. */
  S3_PUBLIC_URL: z.string().url().optional(),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(86400),

  // Rendering
  RENDER_WORK_DIR: z.string().min(1).default('./renders'),
  PYTHON_BIN: z.string().min(1).default('python'),
  /** Directory placed on PYTHONPATH so `narration` / `manim_scenes` import. */
  PYTHON_ROOT: z.string().min(1).default('./packages'),
  FFMPEG_BIN: z.string().min(1).default('ffmpeg'),
  MAX_CRITIQUE_ITERATIONS: z.coerce.number().int().min(0).max(10).default(3),
  // The planner runs its own repair loop (three attempts, feeding the
  // validator's messages back into the transcript), so this outer retry
  // defaults to 1. Raising it multiplies the two loops together.
  MAX_SPEC_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  NARRATION_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * MINUTE),
  MANIM_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * MINUTE),
  REMOTION_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * MINUTE),
  KEYFRAME_TIMEOUT_MS: z.coerce.number().int().positive().default(2 * MINUTE),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly logLevel: Env['LOG_LEVEL'];
  readonly port: number;
  readonly host: string;
  readonly corsOrigin: string;
  readonly anthropicApiKey: string;
  readonly models: {
    readonly planner: string;
    readonly spec: string;
    readonly critique: string;
    readonly gate: string;
  };
  readonly tts: {
    readonly engine: 'kokoro' | 'indextts2';
    readonly kokoroVoice: string;
    readonly indexTts2ModelDir?: string;
  };
  readonly whisperx: { readonly device: string; readonly model: string };
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly bucket: string;
    readonly publicUrl?: string;
    readonly presignTtlSeconds: number;
  };
  readonly renderWorkDir: string;
  readonly pythonBin: string;
  readonly pythonRoot: string;
  readonly ffmpegBin: string;
  readonly maxCritiqueIterations: number;
  readonly maxSpecAttempts: number;
  readonly workerConcurrency: number;
  readonly timeouts: {
    readonly narrationMs: number;
    readonly manimMs: number;
    readonly remotionMs: number;
    readonly keyframeMs: number;
  };
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(`${message}\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Reads `.env` from the repo root and from the current working directory, if
 * present. Real environment variables always win over file contents.
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(repoRoot, '.env'), resolve(cwd, '.env')]) {
    if (existsSync(candidate)) dotenv.config({ path: candidate, override: false });
  }
}

/**
 * Validates a raw environment into a typed config. Pure — pass an object in,
 * get a config or a `ConfigError` listing every problem at once.
 */
export function loadConfig(raw: NodeJS.ProcessEnv = process.env): Config {
  // Treat `FOO=` in a .env file as "not set" so defaults still apply, but keep
  // required variables reported as missing rather than as "must not be empty".
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value.trim();
  }

  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const name = issue.path.join('.') || '(env)';
        const message =
          issue.code === 'invalid_type' && issue.received === 'undefined'
            ? 'is missing'
            : issue.message;
        return `${name} ${message}`;
      })
      .sort();
    throw new ConfigError(
      `Invalid environment (${issues.length} problem${issues.length === 1 ? '' : 's'}). ` +
        'Copy .env.example to .env and fill these in:',
      issues,
    );
  }

  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.PORT,
    host: e.HOST,
    corsOrigin: e.CORS_ORIGIN,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    models: {
      planner: e.PLANNER_MODEL,
      spec: e.SPEC_MODEL,
      critique: e.CRITIQUE_MODEL,
      gate: e.GATE_MODEL,
    },
    tts: {
      engine: e.TTS_ENGINE,
      kokoroVoice: e.KOKORO_VOICE,
      ...(e.INDEXTTS2_MODEL_DIR ? { indexTts2ModelDir: e.INDEXTTS2_MODEL_DIR } : {}),
    },
    whisperx: { device: e.WHISPERX_DEVICE, model: e.WHISPERX_MODEL },
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      bucket: e.S3_BUCKET,
      ...(e.S3_PUBLIC_URL ? { publicUrl: e.S3_PUBLIC_URL } : {}),
      presignTtlSeconds: e.S3_PRESIGN_TTL_SECONDS,
    },
    renderWorkDir: resolve(repoRoot, e.RENDER_WORK_DIR),
    pythonBin: e.PYTHON_BIN,
    pythonRoot: resolve(repoRoot, e.PYTHON_ROOT),
    ffmpegBin: e.FFMPEG_BIN,
    maxCritiqueIterations: e.MAX_CRITIQUE_ITERATIONS,
    maxSpecAttempts: e.MAX_SPEC_ATTEMPTS,
    workerConcurrency: e.WORKER_CONCURRENCY,
    timeouts: {
      narrationMs: e.NARRATION_TIMEOUT_MS,
      manimMs: e.MANIM_TIMEOUT_MS,
      remotionMs: e.REMOTION_TIMEOUT_MS,
      keyframeMs: e.KEYFRAME_TIMEOUT_MS,
    },
  };
}

let cached: Config | undefined;

/**
 * Process-wide config. Lazy so that importing a module for a unit test does not
 * require a fully populated environment.
 */
export function getConfig(): Config {
  if (!cached) {
    loadDotEnv();
    cached = loadConfig(process.env);
  }
  return cached;
}
