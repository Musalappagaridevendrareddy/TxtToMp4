import { randomUUID } from 'node:crypto';

import type { Db, JobPatch, JobRow, JobStatus, RenderRow } from '../db.js';
import { normalizeQuestion } from '../db.js';

/** In-memory stand-in for Postgres. Same surface, no server. */
export interface FakeDb extends Db {
  jobs: Map<string, JobRow>;
  renders: RenderRow[];
  /** Every status the job passed through, in order. */
  stages(jobId: string): string[];
}

export function createFakeDb(seed: JobRow[] = []): FakeDb {
  const jobs = new Map<string, JobRow>(seed.map((j) => [j.id, j]));
  const renders: RenderRow[] = [];

  const db: FakeDb = {
    jobs,
    renders,

    stages(jobId) {
      return renders.filter((r) => r.job_id === jobId).map((r) => r.stage);
    },

    async createJob({ id = randomUUID(), question }) {
      const now = new Date();
      const row: JobRow = {
        id,
        question: normalizeQuestion(question),
        status: 'queued',
        spec: null,
        plan: null,
        error: null,
        video_url: null,
        spec_hash: null,
        iterations: 0,
        created_at: now,
        updated_at: now,
      };
      jobs.set(id, row);
      return row;
    },

    async getJob(id) {
      const row = jobs.get(id);
      return row ? { ...row } : undefined;
    },

    async updateJob(id, patch: JobPatch) {
      const row = jobs.get(id);
      if (!row) return undefined;
      const next: JobRow = {
        ...row,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.spec !== undefined ? { spec: patch.spec } : {}),
        ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.videoUrl !== undefined ? { video_url: patch.videoUrl } : {}),
        ...(patch.specHash !== undefined ? { spec_hash: patch.specHash } : {}),
        ...(patch.iterations !== undefined ? { iterations: patch.iterations } : {}),
        updated_at: new Date(),
      };
      jobs.set(id, next);
      return { ...next };
    },

    async listJobs({ limit, offset, status }) {
      const all = [...jobs.values()]
        .filter((j) => (status ? j.status === status : true))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { jobs: all.slice(offset, offset + limit), total: all.length };
    },

    async findCompletedByQuestion(question) {
      const wanted = normalizeQuestion(question);
      return [...jobs.values()]
        .filter((j) => j.question === wanted && j.status === 'completed' && j.video_url)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
    },

    async findCompletedBySpecHash(specHash, excludeJobId) {
      return [...jobs.values()]
        .filter(
          (j) =>
            j.spec_hash === specHash &&
            j.status === 'completed' &&
            j.video_url &&
            j.id !== excludeJobId,
        )
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
    },

    async recordRender({ jobId, stage, specHash = null, artifactPath = null }) {
      const row: RenderRow = {
        id: randomUUID(),
        job_id: jobId,
        spec_hash: specHash,
        stage,
        artifact_path: artifactPath,
        created_at: new Date(),
      };
      renders.push(row);
      return row;
    },

    async listRenders(jobId) {
      return renders.filter((r) => r.job_id === jobId);
    },

    async ping() {},
    async close() {},
  };

  return db;
}

export function makeJobRow(overrides: Partial<JobRow> & { question: string }): JobRow {
  const now = new Date();
  return {
    id: randomUUID(),
    status: 'completed' as JobStatus,
    spec: null,
    plan: null,
    error: null,
    video_url: null,
    spec_hash: null,
    iterations: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** A spec that survives `parseVideoSpec`: 4 beats, 7.5s each, 30s target. */
export function validSpec(topic = 'How a packet reaches a server') {
  const beat = (id: string, narration: string, emphasis: string[]) => ({
    id,
    narration,
    durationSeconds: 6,
    archetype: 'sequence' as const,
    params: { steps: [{ label: 'Laptop' }, { label: 'Router' }, { label: 'Server' }] },
    emphasis,
    emotion: 'neutral' as const,
    holdAfterSeconds: 1.5,
  });

  return {
    topic,
    arc: 'walkthrough' as const,
    palette: 'cool' as const,
    pacing: 'brisk' as const,
    totalDurationTarget: 30,
    beats: [
      beat('intro', 'A packet leaves your laptop and starts its journey.', ['packet']),
      beat('hop', 'It hops through a router that reads the address.', ['router']),
      beat('route', 'Each hop moves the packet closer to the server.', ['closer']),
      beat('arrive', 'The server receives it and sends a reply back.', ['reply']),
    ],
  };
}

/** A timeline matching `validSpec`, for the given spec hash. */
export function validTimeline(specHash: string) {
  const beats = ['intro', 'hop', 'route', 'arrive'].map((beatId, index) => ({
    beatId,
    startSeconds: index * 7.5,
    audioSeconds: 6,
    holdSeconds: 1.5,
    audioPath: `beats/${beatId}.wav`,
    words: [],
    cues: [],
  }));
  return {
    specHash,
    engine: 'kokoro' as const,
    fps: 30,
    totalSeconds: 30,
    audioPath: 'narration.wav',
    beats,
  };
}
