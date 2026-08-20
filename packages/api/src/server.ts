import { randomUUID } from 'node:crypto';

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import { TERMINAL_STATUSES, type Attachment, type Db, type JobRow, type JobStatus } from './db.js';
import { isMainModule } from './migrate.js';
import { RENDER_QUEUE, type JobEnqueuer } from './queue.js';

/**
 * HTTP surface. Handlers own no business logic beyond validation, cache lookup
 * and enqueueing; everything expensive happens in the worker.
 */

export interface HealthChecks {
  /** Resolves when Postgres answers. */
  db(): Promise<void>;
  /** Resolves when Redis answers. */
  redis(): Promise<void>;
}

export interface ServerDeps {
  db: Db;
  queue: JobEnqueuer;
  health: HealthChecks;
  logLevel?: string;
  corsOrigin?: string;
  /** Per-dependency ceiling for `/healthz` probes. See `withTimeout`. */
  healthTimeoutMs?: number;
  /** Where uploaded files land, one directory per job. */
  uploadDir?: string;
  /** Per-file ceiling. Default 25 MB. */
  maxUploadBytes?: number;
  /** How many files one request may carry. Default 10. */
  maxUploads?: number;
}

/** Default ceiling for a single `/healthz` probe. */
export const HEALTH_TIMEOUT_MS = 2_000;

/**
 * Render a probe failure as something an operator can act on.
 *
 * Node surfaces a failed multi-address connect as an `AggregateError` whose own
 * `message` is empty, which reduces `/healthz` to `postgres: false` with no
 * reason attached. Reach into the first sub-error for the real cause.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map(describeError).filter(Boolean);
    if (inner.length > 0) return [...new Set(inner)].join('; ');
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (err.message) return code ? `${err.message} (${code})` : err.message;
    if (code) return code;
    return err.name;
  }
  return String(err) || 'unknown error';
}

/**
 * Bound a health probe.
 *
 * `/healthz` must answer even when a dependency is unreachable — that is the
 * entire point of it. Neither driver guarantees that on its own: BullMQ
 * requires ioredis be constructed with `maxRetriesPerRequest: null`, which
 * makes a `ping()` to a dead Redis sit in the offline queue and retry forever
 * rather than reject. Without this wrapper the handler awaits that ping
 * indefinitely and the endpoint hangs instead of reporting the outage it
 * exists to report.
 */
function withTimeout(probe: () => Promise<unknown>, ms: number, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms}ms`)), ms);
    // Never let a pending probe hold the process open at shutdown.
    timer.unref?.();

    probe().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

const RenderBody = z.object({
  question: z
    .string({ required_error: 'question is required' })
    .trim()
    .min(8, 'question must be at least 8 characters')
    .max(500, 'question must be at most 500 characters'),
});

const JobParams = z.object({ id: z.string().uuid('id must be a uuid') });

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum([
      'queued',
      'planning',
      'spec',
      'narration',
      'manim',
      'remotion',
      'keyframes',
      'critique',
      'uploading',
      'completed',
      'failed',
      'cancelled',
    ])
    .optional(),
});

/** The public shape of a job. Never exposes `error` internals beyond the message. */
export function toJobView(job: JobRow) {
  return {
    jobId: job.id,
    question: job.question,
    status: job.status,
    stage: job.status,
    error: job.error,
    videoUrl: job.video_url,
    specHash: job.spec_hash,
    iterations: job.iterations,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}


/**
 * Read a multipart body into memory.
 *
 * Uploads are bounded by the plugin's `fileSize`/`files` limits, so buffering
 * is safe and avoids a temp-file dance for what are typically small documents.
 */
async function readMultipart(
  req: { parts(): AsyncIterableIterator<any> },
  maxUploads: number,
): Promise<{ question: string; files: Array<{ filename: string; body: Buffer }> }> {
  let question = '';
  const files: Array<{ filename: string; body: Buffer }> = [];

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (files.length >= maxUploads) {
        throw new HttpError(400, `At most ${maxUploads} files may be uploaded`);
      }
      const body = await part.toBuffer();
      if (body.length > 0) {
        files.push({ filename: safeName(part.filename ?? 'upload'), body });
      }
    } else if (part.fieldname === 'question') {
      question = String(part.value ?? '');
    }
  }

  const parsed = RenderBody.safeParse({ question });
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid request body',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return { question: parsed.data.question, files };
}

/**
 * Reduce a client-supplied filename to something safe to join onto a path.
 *
 * The name arrives from the browser and is attacker-controlled: `basename`
 * strips any directory component, and the remaining sanitisation removes what
 * could still surprise a shell or a filesystem downstream.
 */
export function safeName(raw: string): string {
  const base = basename(raw).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  const trimmed = base.slice(0, 120);
  return trimmed || `upload${extname(raw) || ''}`;
}

async function persistUploads(
  jobId: string,
  files: Array<{ filename: string; body: Buffer }>,
  root: string,
): Promise<Attachment[]> {
  if (files.length === 0) return [];

  const dir = join(root, jobId, 'uploads');
  await mkdir(dir, { recursive: true });

  const out: Attachment[] = [];
  const used = new Set<string>();

  for (const file of files) {
    // Two uploads called "scan.pdf" must not clobber each other.
    let name = file.filename;
    let n = 1;
    while (used.has(name)) {
      const ext = extname(file.filename);
      name = `${file.filename.slice(0, file.filename.length - ext.length)}_${n++}${ext}`;
    }
    used.add(name);

    await writeFile(join(dir, name), file.body);
    out.push({ filename: name, path: join('uploads', name), bytes: file.body.length });
  }
  return out;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  const maxUploadBytes = deps.maxUploadBytes ?? 25 * 1024 * 1024;
  const maxUploads = deps.maxUploads ?? 10;

  app.register(cors, { origin: deps.corsOrigin ?? '*' });
  app.register(multipart, {
    limits: { fileSize: maxUploadBytes, files: maxUploads, fields: 10 },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
  });

  // POST /render ---------------------------------------------------------
  // Accepts JSON `{question}` or multipart with a `question` field plus any
  // number of files. Uploads are evidence carried alongside the question, so a
  // request without them behaves exactly as it did before.
  app.post('/render', async (req, reply) => {
    let question: string;
    let pending: Array<{ filename: string; body: Buffer }> = [];

    if (req.isMultipart()) {
      const collected = await readMultipart(req, maxUploads);
      question = collected.question;
      pending = collected.files;
    } else {
      const body = RenderBody.safeParse(req.body);
      if (!body.success) {
        throw new HttpError(
          400,
          'Invalid request body',
          body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
        );
      }
      question = body.data.question;
    }

    // Cache on the question alone only when nothing was uploaded: the same
    // words with a different document are a different job.
    if (pending.length === 0) {
      const cached = await deps.db.findCompletedByQuestion(question);
      if (cached?.video_url) {
        req.log.info({ jobId: cached.id, specHash: cached.spec_hash }, 'question cache hit');
        return reply.code(200).send({
          jobId: cached.id,
          cached: true,
          videoUrl: cached.video_url,
          status: cached.status,
        });
      }
    }

    const jobId = randomUUID();
    const attachments = await persistUploads(jobId, pending, deps.uploadDir ?? './renders');

    const job = await deps.db.createJob({ id: jobId, question, attachments });
    await deps.queue.add(RENDER_QUEUE, { jobId: job.id, question: job.question });
    req.log.info({ jobId: job.id, attachments: attachments.length }, 'render enqueued');

    return reply.code(202).send({
      jobId: job.id,
      cached: false,
      status: job.status,
      attachments: attachments.map((a) => a.filename),
    });
  });

  // GET /jobs/:id --------------------------------------------------------
  app.get('/jobs/:id', async (req, reply) => {
    const params = JobParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, 'Invalid job id');

    const job = await deps.db.getJob(params.data.id);
    if (!job) throw new HttpError(404, 'Job not found');

    return reply.send(toJobView(job));
  });

  // GET /jobs ------------------------------------------------------------
  app.get('/jobs', async (req, reply) => {
    const query = ListQuery.safeParse(req.query ?? {});
    if (!query.success) {
      throw new HttpError(
        400,
        'Invalid query',
        query.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }

    const { limit, offset, status } = query.data;
    const { jobs, total } = await deps.db.listJobs({
      limit,
      offset,
      ...(status ? { status: status as JobStatus } : {}),
    });

    return reply.send({
      jobs: jobs.map(toJobView),
      total,
      limit,
      offset,
      hasMore: offset + jobs.length < total,
    });
  });

  // DELETE /jobs/:id -----------------------------------------------------
  app.delete('/jobs/:id', async (req, reply) => {
    const params = JobParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, 'Invalid job id');

    const job = await deps.db.getJob(params.data.id);
    if (!job) throw new HttpError(404, 'Job not found');
    if (TERMINAL_STATUSES.includes(job.status)) {
      throw new HttpError(409, `Job is already ${job.status} and cannot be cancelled`);
    }

    // Drop it from the queue if it has not started. If it is already running,
    // the status flip is the signal — the worker checks between stages.
    const queued = await deps.queue.getJob(job.id).catch(() => undefined);
    if (queued) {
      const state = await queued.getState().catch(() => 'unknown');
      if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
        await queued.remove().catch(() => undefined);
      }
    }

    const updated = await deps.db.updateJob(job.id, {
      status: 'cancelled',
      error: 'cancelled by request',
    });
    req.log.info({ jobId: job.id }, 'job cancelled');

    return reply.send(toJobView(updated ?? { ...job, status: 'cancelled' }));
  });

  // GET /healthz ---------------------------------------------------------
  app.get('/healthz', async (_req, reply) => {
    const budget = deps.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    const [postgres, redis] = await Promise.all([
      withTimeout(() => deps.health.db(), budget, 'postgres').then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, error: describeError(e) }),
      ),
      withTimeout(() => deps.health.redis(), budget, 'redis').then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, error: describeError(e) }),
      ),
    ]);

    const ok = postgres.ok && redis.ok;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      postgres: postgres.ok,
      redis: redis.ok,
      ...(ok ? {} : { detail: { postgres, redis } }),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'Not Found', requestId: String(req.id) });
  });

  // Global error handler: clients get a message, logs get everything -------
  app.setErrorHandler((error: unknown, req, reply) => {
    // Fastify types this as `unknown` in strict mode; narrow once here rather
    // than casting at each of the six use sites below.
    const err = error as { statusCode?: unknown; message?: unknown; stack?: unknown };
    const message = typeof err.message === 'string' ? err.message : 'Request failed';

    const status =
      error instanceof HttpError
        ? error.statusCode
        : typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
          ? err.statusCode
          : 500;

    if (status >= 500) {
      req.log.error({ err: error, stack: err.stack, reqId: req.id }, 'request failed');
    } else {
      req.log.warn({ err: message, reqId: req.id }, 'request rejected');
    }

    reply.code(status).send({
      error: status >= 500 ? 'Internal Server Error' : message,
      ...(error instanceof HttpError && error.details ? { details: error.details } : {}),
      requestId: String(req.id),
    });
  });

  return app;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

if (isMainModule(import.meta.url)) {
  const [{ getConfig }, { createDb, createPool }, { createRedis, createRenderQueue }] =
    await Promise.all([import('./config.js'), import('./db.js'), import('./queue.js')]);

  const config = getConfig();
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  const connection = createRedis(config.redisUrl);
  const queue = createRenderQueue(connection);

  const app = buildServer({
    db,
    queue,
    logLevel: config.logLevel,
    corsOrigin: config.corsOrigin,
    health: {
      db: () => db.ping(),
      redis: async () => {
        const pong = await connection.ping();
        if (pong !== 'PONG') throw new Error(`redis replied ${pong}`);
      },
    },
  });

  const shutdown = async () => {
    await app.close();
    await queue.close().catch(() => {});
    await connection.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}
