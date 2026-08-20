import { Queue, type JobsOptions } from 'bullmq';
// ioredis ships CommonJS; under NodeNext its default export is the namespace,
// not the constructor. The named Redis class is the constructable one.
import { Redis } from 'ioredis';

/** The one queue. Render jobs are long and serial; there is nothing else to schedule. */
export const RENDER_QUEUE = 'render';

/**
 * Everything the worker needs to start. The question is stored on the job row
 * too; it is duplicated here only so the worker can log without a round trip.
 */
export interface RenderJobData {
  jobId: string;
  question: string;
}

export const RENDER_JOB_OPTIONS: JobsOptions = {
  attempts: 3, // the first try plus 2 retries
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 604_800 },
  removeOnFail: { age: 604_800 },
};

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on,
 * so both the queue and the worker share this factory.
 */
export function createRedis(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export type RenderQueue = Queue<RenderJobData, void, string>;

export function createRenderQueue(connection: Redis): RenderQueue {
  return new Queue<RenderJobData, void, string>(RENDER_QUEUE, {
    connection,
    defaultJobOptions: RENDER_JOB_OPTIONS,
  });
}

/** The subset of the queue the server uses, so tests can inject a fake. */
export interface JobEnqueuer {
  add(name: string, data: RenderJobData, opts?: JobsOptions): Promise<{ id?: string }>;
  getJob(id: string): Promise<
    | {
        id?: string;
        remove(): Promise<unknown>;
        getState(): Promise<string>;
      }
    | undefined
  >;
}
