// Minimal stand-ins for the runtime dependencies, so `tsc` can check the
// project's own logic on a machine where npm install has not been run.
// These mirror the real public surfaces closely enough to catch misuse.

declare module 'pg' {
  export interface QueryResult<R> {
    rows: R[];
    rowCount: number | null;
  }
  export interface PoolClient {
    query<R = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
    release(): void;
  }
  export class Pool {
    constructor(config?: {
      connectionString?: string;
      max?: number;
      idleTimeoutMillis?: number;
      connectionTimeoutMillis?: number;
    });
    query<R = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
  const _default: { Pool: typeof Pool };
  export default _default;
}

declare module 'dotenv' {
  const _default: {
    config(options?: { path?: string; override?: boolean }): { parsed?: Record<string, string> };
  };
  export default _default;
}

declare module 'ioredis' {
  export class Redis {
    constructor(url: string, options?: { maxRetriesPerRequest?: null | number; enableReadyCheck?: boolean });
    ping(): Promise<string>;
    quit(): Promise<'OK'>;
  }
  export default Redis;
}

declare module 'bullmq' {
  import type { Redis } from 'ioredis';
  export interface JobsOptions {
    attempts?: number;
    backoff?: { type: string; delay: number };
    removeOnComplete?: { age: number } | boolean | number;
    removeOnFail?: { age: number } | boolean | number;
  }
  export type JobState = 'completed' | 'failed' | 'delayed' | 'active' | 'waiting' | 'prioritized';
  export class Job<D = any, R = any, N extends string = string> {
    id?: string;
    name: N;
    data: D;
    remove(opts?: { removeChildren?: boolean }): Promise<void>;
    getState(): Promise<JobState | 'unknown'>;
  }
  export class Queue<D = any, R = any, N extends string = string> {
    constructor(name: string, opts: { connection: Redis; defaultJobOptions?: JobsOptions });
    add(name: N, data: D, opts?: JobsOptions): Promise<Job<D, R, N>>;
    getJob(id: string): Promise<Job<D, R, N> | undefined>;
    close(): Promise<void>;
  }
  export class Worker<D = any, R = any, N extends string = string> {
    constructor(
      name: string,
      processor: (job: Job<D, R, N>) => Promise<R>,
      opts: { connection: Redis; concurrency?: number; lockDuration?: number },
    );
    on(event: 'failed', cb: (job: Job<D, R, N> | undefined, error: Error) => void): this;
    close(): Promise<void>;
  }
  export class UnrecoverableError extends Error {}
}

declare module 'pino' {
  export interface Logger {
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
  }
  function pino(options?: { level?: string; name?: string }): Logger;
  export default pino;
}

declare module 'fastify' {
  export interface FastifyRequest {
    id: string | number;
    body: unknown;
    params: unknown;
    query: unknown;
    headers: Record<string, string | string[] | undefined>;
    log: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
  }
  export interface FastifyReply {
    code(status: number): FastifyReply;
    header(name: string, value: string): FastifyReply;
    send(payload?: unknown): FastifyReply;
  }
  export interface FastifyError extends Error {
    statusCode?: number;
  }
  export interface InjectResponse {
    statusCode: number;
    payload: string;
    json(): any;
  }
  type Handler = (req: FastifyRequest, reply: FastifyReply) => unknown;
  export interface FastifyInstance {
    register(plugin: unknown, opts?: unknown): FastifyInstance;
    addHook(name: 'onSend', fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>): FastifyInstance;
    get(path: string, handler: Handler): FastifyInstance;
    post(path: string, handler: Handler): FastifyInstance;
    delete(path: string, handler: Handler): FastifyInstance;
    setNotFoundHandler(handler: Handler): FastifyInstance;
    setErrorHandler(handler: (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => unknown): FastifyInstance;
    inject(opts: { method: string; url: string; payload?: unknown }): Promise<InjectResponse>;
    listen(opts: { port: number; host: string }): Promise<string>;
    close(): Promise<void>;
  }
  function Fastify(opts?: {
    logger?: { level?: string; redact?: string[] } | boolean;
    genReqId?: (req: { headers: Record<string, string | string[] | undefined> }) => string;
    requestIdHeader?: string;
    disableRequestLogging?: boolean;
  }): FastifyInstance;
  export default Fastify;
}

declare module '@fastify/cors' {
  const plugin: unknown;
  export default plugin;
}

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config: {
      endpoint?: string;
      region?: string;
      forcePathStyle?: boolean;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    });
    send(command: unknown): Promise<unknown>;
  }
  export class PutObjectCommand {
    constructor(input: {
      Bucket: string;
      Key: string;
      Body?: unknown;
      ContentLength?: number;
      ContentType?: string;
    });
  }
  export class GetObjectCommand {
    constructor(input: { Bucket: string; Key: string });
  }
  export class HeadBucketCommand {
    constructor(input: { Bucket: string });
  }
}

declare module '@aws-sdk/s3-request-presigner' {
  import type { S3Client } from '@aws-sdk/client-s3';
  export function getSignedUrl(
    client: S3Client,
    command: unknown,
    options?: { expiresIn?: number },
  ): Promise<string>;
}

declare module '@explainer/planner' {
  export function plan(input: { question: string }): Promise<string>;
  export function emitSpec(input: { question: string; plan: string; feedback?: string[] }): Promise<unknown>;
  export function critique(input: unknown): Promise<{ approved: boolean; notes: string[]; revisedSpec?: unknown }>;
}

declare module '@explainer/compositor' {
  export function renderExplainer(input: {
    specPath: string;
    timelinePath: string;
    assetsDir: string;
    outPath: string;
  }): Promise<string>;
}
