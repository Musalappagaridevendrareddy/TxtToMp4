import { randomUUID } from 'node:crypto';

import type { Db, JobPatch, JobRow, JobStatus, RenderRow } from '../db.js';
import { normalizeQuestion } from '../db.js';

export { validSpec, validTimeline } from './fixtures.js';

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
