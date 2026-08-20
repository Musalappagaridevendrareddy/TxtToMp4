import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import { TERMINAL_STATUSES, type Db, type JobRow, type JobStatus } from './db.js';
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

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  });

  app.register(cors, { origin: deps.corsOrigin ?? '*' });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
  });

  // POST /render ---------------------------------------------------------
  app.post('/render', async (req, reply) => {
    const body = RenderBody.safeParse(req.body);
    if (!body.success) {
      throw new HttpError(
        400,
        'Invalid request body',
        body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      );
    }

    const { question } = body.data;

    // Cache: the same question already produced a finished video.
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

    const job = await deps.db.createJob({ question });
    await deps.queue.add(RENDER_QUEUE, { jobId: job.id, question: job.question });
    req.log.info({ jobId: job.id }, 'render enqueued');

    return reply.code(202).send({ jobId: job.id, cached: false, status: job.status });
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
    const [postgres, redis] = await Promise.all([
      deps.health.db().then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, error: (e as Error).message }),
      ),
      deps.health.redis().then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, error: (e as Error).message }),
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
  app.setErrorHandler((error, req, reply) => {
    const status =
      error instanceof HttpError
        ? error.statusCode
        : typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
          ? error.statusCode
          : 500;

    if (status >= 500) {
      req.log.error({ err: error, stack: error.stack, reqId: req.id }, 'request failed');
    } else {
      req.log.warn({ err: error.message, reqId: req.id }, 'request rejected');
    }

    reply.code(status).send({
      error: status >= 500 ? 'Internal Server Error' : error.message,
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
