import { randomUUID } from 'node:crypto';

import pg from 'pg';
import type { Pool } from 'pg';

// `pg` is CommonJS; destructuring the default export is the supported way to
// reach its classes from an ES module.
const { Pool: PgPool } = pg;

/**
 * Postgres access. Every statement is parameterised — no string interpolation
 * of user input anywhere in this file.
 */

export type JobStatus =
  | 'queued'
  | 'planning'
  | 'spec'
  | 'narration'
  | 'manim'
  | 'remotion'
  | 'keyframes'
  | 'critique'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Terminal states: the worker will not touch these again. */
export const TERMINAL_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'cancelled'];

export interface JobRow {
  id: string;
  question: string;
  status: JobStatus;
  spec: unknown | null;
  plan: string | null;
  error: string | null;
  video_url: string | null;
  spec_hash: string | null;
  iterations: number;
  created_at: Date;
  updated_at: Date;
}

export interface RenderRow {
  id: string;
  job_id: string;
  spec_hash: string | null;
  stage: string;
  artifact_path: string | null;
  created_at: Date;
}

export interface JobPatch {
  status?: JobStatus;
  spec?: unknown;
  plan?: string;
  error?: string | null;
  videoUrl?: string | null;
  specHash?: string | null;
  iterations?: number;
}

/**
 * The surface the server and worker actually use. Narrow on purpose so tests
 * can hand in a fake without standing up Postgres.
 */
export interface Db {
  createJob(input: { id?: string; question: string }): Promise<JobRow>;
  getJob(id: string): Promise<JobRow | undefined>;
  updateJob(id: string, patch: JobPatch): Promise<JobRow | undefined>;
  listJobs(input: { limit: number; offset: number; status?: JobStatus }): Promise<{
    jobs: JobRow[];
    total: number;
  }>;
  /** Most recent completed job with a video for an identical question. */
  findCompletedByQuestion(question: string): Promise<JobRow | undefined>;
  /** Most recent completed job with a video for the same spec hash. */
  findCompletedBySpecHash(specHash: string, excludeJobId?: string): Promise<JobRow | undefined>;
  recordRender(input: {
    jobId: string;
    stage: string;
    specHash?: string | null;
    artifactPath?: string | null;
  }): Promise<RenderRow>;
  listRenders(jobId: string): Promise<RenderRow[]>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Questions are compared verbatim for cache lookups, so they are normalised
 * once on the way in. Whitespace-only differences are not different questions.
 */
export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, ' ');
}

export function createPool(databaseUrl: string): Pool {
  return new PgPool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const JOB_COLUMNS =
  'id, question, status, spec, plan, error, video_url, spec_hash, iterations, created_at, updated_at';

export function createDb(pool: Pool): Db {
  return {
    async createJob({ id = randomUUID(), question }) {
      const { rows } = await pool.query<JobRow>(
        `INSERT INTO jobs (id, question, status) VALUES ($1, $2, 'queued') RETURNING ${JOB_COLUMNS}`,
        [id, normalizeQuestion(question)],
      );
      return rows[0]!;
    },

    async getJob(id) {
      const { rows } = await pool.query<JobRow>(
        `SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`,
        [id],
      );
      return rows[0];
    },

    async updateJob(id, patch) {
      const sets: string[] = ['updated_at = now()'];
      const values: unknown[] = [id];
      const push = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };

      if (patch.status !== undefined) push('status', patch.status);
      if (patch.spec !== undefined) push('spec', JSON.stringify(patch.spec));
      if (patch.plan !== undefined) push('plan', patch.plan);
      if (patch.error !== undefined) push('error', patch.error);
      if (patch.videoUrl !== undefined) push('video_url', patch.videoUrl);
      if (patch.specHash !== undefined) push('spec_hash', patch.specHash);
      if (patch.iterations !== undefined) push('iterations', patch.iterations);

      const { rows } = await pool.query<JobRow>(
        `UPDATE jobs SET ${sets.join(', ')} WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
        values,
      );
      return rows[0];
    },

    async listJobs({ limit, offset, status }) {
      const where = status ? 'WHERE status = $3' : '';
      const params: unknown[] = status ? [limit, offset, status] : [limit, offset];
      const [list, count] = await Promise.all([
        pool.query<JobRow>(
          `SELECT ${JOB_COLUMNS} FROM jobs ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          params,
        ),
        pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM jobs ${status ? 'WHERE status = $1' : ''}`,
          status ? [status] : [],
        ),
      ]);
      return { jobs: list.rows, total: Number(count.rows[0]?.count ?? 0) };
    },

    async findCompletedByQuestion(question) {
      const { rows } = await pool.query<JobRow>(
        `SELECT ${JOB_COLUMNS} FROM jobs
          WHERE question = $1 AND status = 'completed' AND video_url IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        [normalizeQuestion(question)],
      );
      return rows[0];
    },

    async findCompletedBySpecHash(specHash, excludeJobId) {
      const { rows } = await pool.query<JobRow>(
        `SELECT ${JOB_COLUMNS} FROM jobs
          WHERE spec_hash = $1 AND status = 'completed' AND video_url IS NOT NULL
            AND ($2::uuid IS NULL OR id <> $2::uuid)
          ORDER BY created_at DESC LIMIT 1`,
        [specHash, excludeJobId ?? null],
      );
      return rows[0];
    },

    async recordRender({ jobId, stage, specHash = null, artifactPath = null }) {
      const { rows } = await pool.query<RenderRow>(
        `INSERT INTO renders (id, job_id, spec_hash, stage, artifact_path)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, job_id, spec_hash, stage, artifact_path, created_at`,
        [randomUUID(), jobId, specHash, stage, artifactPath],
      );
      return rows[0]!;
    },

    async listRenders(jobId) {
      const { rows } = await pool.query<RenderRow>(
        `SELECT id, job_id, spec_hash, stage, artifact_path, created_at
           FROM renders WHERE job_id = $1 ORDER BY created_at ASC`,
        [jobId],
      );
      return rows;
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    async close() {
      await pool.end();
    },
  };
}
