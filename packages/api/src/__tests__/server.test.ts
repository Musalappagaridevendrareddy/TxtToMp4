import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JobsOptions } from 'bullmq';

import type { RenderJobData } from '../queue.js';
import { buildServer, type ServerDeps } from '../server.js';
import { createFakeDb, makeJobRow, type FakeDb } from './fakes.js';

interface Enqueued {
  name: string;
  data: RenderJobData;
  opts?: JobsOptions;
}

function harness(seed = createFakeDb()) {
  const enqueued: Enqueued[] = [];
  const removed: string[] = [];
  const states = new Map<string, string>();

  const deps: ServerDeps = {
    db: seed,
    logLevel: 'silent',
    queue: {
      async add(name, data, opts) {
        enqueued.push({ name, data, ...(opts ? { opts } : {}) });
        return { id: data.jobId };
      },
      async getJob(id) {
        if (!states.has(id)) return undefined;
        return {
          id,
          async getState() {
            return states.get(id) ?? 'unknown';
          },
          async remove() {
            removed.push(id);
            return undefined;
          },
        };
      },
    },
    health: { db: async () => {}, redis: async () => {} },
  };

  return { app: buildServer(deps), db: seed, enqueued, removed, states, deps };
}

const QUESTION = 'How does a packet reach a server?';

test('POST /render enqueues a new job and returns 202', async (t) => {
  const { app, enqueued, db } = harness();
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/render', payload: { question: QUESTION } });

  assert.equal(res.statusCode, 202);
  const body = res.json();
  assert.equal(body.cached, false);
  assert.ok(body.jobId);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0]!.data, { jobId: body.jobId, question: QUESTION });
  assert.equal(db.jobs.get(body.jobId)?.status, 'queued');
});

test('POST /render returns the cached video and does NOT enqueue', async (t) => {
  const db = createFakeDb([
    makeJobRow({
      question: QUESTION,
      status: 'completed',
      video_url: 'http://localhost:9000/renders/videos/old/abc.mp4',
      spec_hash: 'abc123',
    }),
  ]);
  const { app, enqueued } = harness(db);
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/render', payload: { question: QUESTION } });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    jobId: [...db.jobs.values()][0]!.id,
    cached: true,
    videoUrl: 'http://localhost:9000/renders/videos/old/abc.mp4',
    status: 'completed',
  });
  assert.equal(enqueued.length, 0, 'a cache hit must not enqueue work');
  assert.equal(db.jobs.size, 1, 'a cache hit must not create a job row');
});

test('the question cache ignores surrounding whitespace but not wording', async (t) => {
  const db = createFakeDb([
    makeJobRow({
      question: QUESTION,
      status: 'completed',
      video_url: 'http://minio/renders/v.mp4',
    }),
  ]);
  const { app, enqueued } = harness(db);
  t.after(() => app.close());

  const padded = await app.inject({
    method: 'POST',
    url: '/render',
    payload: { question: `  How does a   packet reach a server?  ` },
  });
  assert.equal(padded.json().cached, true);
  assert.equal(enqueued.length, 0);

  const different = await app.inject({
    method: 'POST',
    url: '/render',
    payload: { question: 'How does a packet reach a printer?' },
  });
  assert.equal(different.statusCode, 202);
  assert.equal(enqueued.length, 1);
});

test('a failed job is not treated as a cache hit', async (t) => {
  const db = createFakeDb([
    makeJobRow({ question: QUESTION, status: 'failed', error: 'manim: boom', video_url: null }),
  ]);
  const { app, enqueued } = harness(db);
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/render', payload: { question: QUESTION } });
  assert.equal(res.statusCode, 202);
  assert.equal(enqueued.length, 1);
});

test('POST /render rejects bad input with a field listing', async (t) => {
  const { app, enqueued } = harness();
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/render', payload: { question: 'short' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().details.join(''), /at least 8 characters/);
  assert.equal(enqueued.length, 0);

  const missing = await app.inject({ method: 'POST', url: '/render', payload: {} });
  assert.equal(missing.statusCode, 400);
  assert.equal(enqueued.length, 0);
});

test('GET /jobs/:id reports status, error, videoUrl and iterations', async (t) => {
  const job = makeJobRow({
    question: QUESTION,
    status: 'critique',
    iterations: 2,
    error: null,
    video_url: null,
  });
  const { app } = harness(createFakeDb([job]));
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: `/jobs/${job.id}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'critique');
  assert.equal(body.stage, 'critique');
  assert.equal(body.iterations, 2);
  assert.equal(body.videoUrl, null);

  const missing = await app.inject({
    method: 'GET',
    url: '/jobs/00000000-0000-4000-8000-000000000000',
  });
  assert.equal(missing.statusCode, 404);

  const malformed = await app.inject({ method: 'GET', url: '/jobs/not-a-uuid' });
  assert.equal(malformed.statusCode, 400);
});

test('GET /jobs paginates', async (t) => {
  const db = createFakeDb();
  for (let i = 0; i < 5; i += 1) {
    const row = await db.createJob({ question: `Question number ${i} about networking` });
    row.created_at = new Date(Date.now() + i * 1000);
    db.jobs.set(row.id, row);
  }
  const { app } = harness(db);
  t.after(() => app.close());

  const first = await app.inject({ method: 'GET', url: '/jobs?limit=2&offset=0' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().jobs.length, 2);
  assert.equal(first.json().total, 5);
  assert.equal(first.json().hasMore, true);

  const last = await app.inject({ method: 'GET', url: '/jobs?limit=2&offset=4' });
  assert.equal(last.json().jobs.length, 1);
  assert.equal(last.json().hasMore, false);

  const bad = await app.inject({ method: 'GET', url: '/jobs?limit=1000' });
  assert.equal(bad.statusCode, 400);
});

test('DELETE /jobs/:id cancels a queued job and removes it from the queue', async (t) => {
  const job = makeJobRow({ question: QUESTION, status: 'queued', video_url: null });
  const { app, db, removed, states } = harness(createFakeDb([job]));
  states.set(job.id, 'waiting');
  t.after(() => app.close());

  const res = await app.inject({ method: 'DELETE', url: `/jobs/${job.id}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'cancelled');
  assert.deepEqual(removed, [job.id]);
  assert.equal(db.jobs.get(job.id)?.status, 'cancelled');
});

test('DELETE /jobs/:id flags an active job without removing it from the queue', async (t) => {
  const job = makeJobRow({ question: QUESTION, status: 'manim', video_url: null });
  const { app, db, removed, states } = harness(createFakeDb([job]));
  states.set(job.id, 'active');
  t.after(() => app.close());

  const res = await app.inject({ method: 'DELETE', url: `/jobs/${job.id}` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(removed, [], 'an active job must not be yanked out from under the worker');
  assert.equal(db.jobs.get(job.id)?.status, 'cancelled');
});

test('DELETE /jobs/:id refuses to cancel a finished job', async (t) => {
  const job = makeJobRow({ question: QUESTION, status: 'completed', video_url: 'http://x/v.mp4' });
  const { app } = harness(createFakeDb([job]));
  t.after(() => app.close());

  const res = await app.inject({ method: 'DELETE', url: `/jobs/${job.id}` });
  assert.equal(res.statusCode, 409);
});

test('GET /healthz is 200 when both dependencies answer', async (t) => {
  const { app } = harness();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', postgres: true, redis: true });
});

test('GET /healthz is 503 when Postgres or Redis is down', async (t) => {
  const db = createFakeDb();
  const app = buildServer({
    db,
    logLevel: 'silent',
    queue: { async add() { return {}; }, async getJob() { return undefined; } },
    health: {
      db: async () => {
        throw new Error('ECONNREFUSED 5432');
      },
      redis: async () => {},
    },
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().postgres, false);
  assert.equal(res.json().redis, true);
});

test('GET /healthz answers 503 when a dependency hangs instead of refusing', async (t) => {
  // The failure this pins: ioredis constructed for BullMQ
  // (`maxRetriesPerRequest: null`) queues a ping to a dead Redis and retries
  // forever rather than rejecting, so an unbounded probe leaves /healthz
  // hanging indefinitely — the one thing a health endpoint must never do.
  const app = buildServer({
    db: createFakeDb(),
    logLevel: 'silent',
    queue: {
      async add() {
        return {};
      },
      async getJob() {
        return undefined;
      },
    },
    healthTimeoutMs: 50,
    health: {
      db: async () => {},
      redis: () => new Promise<void>(() => {}), // never settles
    },
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/healthz' });

  assert.equal(res.statusCode, 503);
  assert.equal(res.json().postgres, true);
  assert.equal(res.json().redis, false);
  assert.match(res.json().detail.redis.error, /did not answer within 50ms/);
});

test('unexpected errors return a request id and never a stack trace', async (t) => {
  const db = createFakeDb();
  db.findCompletedByQuestion = async () => {
    throw new Error('connection terminated at /app/src/db.ts:120');
  };
  const app = buildServer({
    db,
    logLevel: 'silent',
    queue: { async add() { return {}; }, async getJob() { return undefined; } },
    health: { db: async () => {}, redis: async () => {} },
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'POST', url: '/render', payload: { question: QUESTION } });

  assert.equal(res.statusCode, 500);
  const body = res.json();
  assert.equal(body.error, 'Internal Server Error');
  assert.ok(body.requestId, 'clients get a request id to quote in a bug report');
  assert.equal(res.payload.includes('db.ts'), false, 'internal paths must not leak');
  assert.equal(res.payload.includes('connection terminated'), false);
});
