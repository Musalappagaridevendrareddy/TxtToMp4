import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Pool } from 'pg';

import { createPool } from './db.js';

/** True when this module is the process entry point (`node dist/migrate.js`). */
export function isMainModule(moduleUrl: string, argv1 = process.argv[1]): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

/**
 * Idempotent migration runner. Applied files are recorded with a checksum so a
 * migration that is edited after being applied fails loudly instead of silently
 * diverging between environments.
 */

/** `packages/api/dist/migrate.js` -> `packages/api/migrations`. */
export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

export async function migrate(
  pool: Pool,
  dir: string = MIGRATIONS_DIR,
  log: (message: string) => void = () => {},
): Promise<MigrationResult> {
  await pool.query(CREATE_TABLE);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations',
  );
  const alreadyApplied = new Map<string, string>();
  for (const row of rows) alreadyApplied.set(row.filename, row.checksum);

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const filename of files) {
    const sql = await readFile(resolve(dir, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = alreadyApplied.get(filename);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${filename} was already applied but its contents changed ` +
            `(recorded ${previous.slice(0, 12)}, found ${checksum.slice(0, 12)}). ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
      result.skipped.push(filename);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        filename,
        checksum,
      ]);
      await client.query('COMMIT');
      result.applied.push(filename);
      log(`applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${filename} failed: ${(error as Error).message}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  return result;
}

if (isMainModule(import.meta.url)) {
  const { getConfig } = await import('./config.js');
  const config = getConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const result = await migrate(pool, MIGRATIONS_DIR, (m) => console.log(m));
    console.log(
      `migrations: ${result.applied.length} applied, ${result.skipped.length} already present`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
