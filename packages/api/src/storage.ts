import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { GetObjectCommand, PutObjectCommand, S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage. Configured for MinIO by default
 * (`forcePathStyle`, explicit endpoint), which is also valid against real S3.
 */

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  /** Base URL browsers should use, when it differs from the internal endpoint. */
  publicUrl?: string;
  presignTtlSeconds: number;
}

export interface Storage {
  /** Uploads a local file and returns a stable URL for it. */
  uploadVideo(localPath: string, key: string): Promise<string>;
  /** Time-limited GET URL. Falls back to the config TTL. */
  presignedGetUrl(key: string, ttlSeconds?: number): Promise<string>;
  /** Public (non-signed) URL for a key. */
  publicUrlFor(key: string): string;
  ping(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** `renders/<jobId>/<specHash>.mp4` — stable and cache-friendly. */
export function videoKey(jobId: string, specHash: string, localPath = 'out.mp4'): string {
  return `videos/${jobId}/${specHash}${extname(basename(localPath)) || '.mp4'}`;
}

export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true, // MinIO does not do virtual-hosted-style buckets
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  });
}

export function createStorage(config: StorageConfig, client = createS3Client(config)): Storage {
  const base = (config.publicUrl ?? config.endpoint).replace(/\/+$/, '');

  return {
    async uploadVideo(localPath, key) {
      // ContentLength is required because a read stream has no known length and
      // the SDK will not buffer it for us.
      const { size } = await stat(localPath);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: createReadStream(localPath),
          ContentLength: size,
          ContentType: contentTypeFor(localPath),
        }),
      );
      return this.publicUrlFor(key);
    },

    async presignedGetUrl(key, ttlSeconds = config.presignTtlSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    },

    publicUrlFor(key) {
      return `${base}/${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    },

    async ping() {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    },
  };
}
