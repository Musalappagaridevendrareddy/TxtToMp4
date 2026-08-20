import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError, loadConfig } from '../config.js';

const complete = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  DATABASE_URL: 'postgres://explainer:explainer@localhost:5432/explainer',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_BUCKET: 'renders',
} satisfies NodeJS.ProcessEnv;

test('accepts a complete environment and applies documented defaults', () => {
  const config = loadConfig({ ...complete });

  assert.equal(config.databaseUrl, complete.DATABASE_URL);
  assert.equal(config.s3.bucket, 'renders');
  assert.equal(config.tts.engine, 'kokoro');
  assert.equal(config.tts.kokoroVoice, 'af_heart');
  assert.equal(config.models.planner, 'claude-opus-5');
  assert.equal(config.models.gate, 'claude-haiku-4-5');
  assert.equal(config.whisperx.model, 'base.en');
  assert.equal(config.maxCritiqueIterations, 3);
  assert.equal(config.timeouts.narrationMs, 600_000);
  assert.equal(config.timeouts.manimMs, 1_800_000);
  assert.equal(config.timeouts.remotionMs, 1_800_000);
});

test('a missing variable produces a ConfigError listing it by name', () => {
  const { ANTHROPIC_API_KEY: _dropped, ...withoutKey } = complete;

  assert.throws(
    () => loadConfig(withoutKey),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, 'expected a ConfigError');
      assert.deepEqual(error.issues, ['ANTHROPIC_API_KEY is missing']);
      assert.match(error.message, /ANTHROPIC_API_KEY is missing/);
      assert.match(error.message, /Copy \.env\.example/);
      return true;
    },
  );
});

test('every missing variable is listed at once, not one per run', () => {
  assert.throws(
    () => loadConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.issues, [
        'ANTHROPIC_API_KEY is missing',
        'DATABASE_URL is missing',
        'REDIS_URL is missing',
        'S3_ACCESS_KEY is missing',
        'S3_BUCKET is missing',
        'S3_ENDPOINT is missing',
        'S3_SECRET_KEY is missing',
      ]);
      assert.match(error.message, /7 problems/);
      return true;
    },
  );
});

test('an empty value is treated as missing so defaults still apply', () => {
  const config = loadConfig({ ...complete, PLANNER_MODEL: '   ' });
  assert.equal(config.models.planner, 'claude-opus-5');

  assert.throws(() => loadConfig({ ...complete, ANTHROPIC_API_KEY: '' }), ConfigError);
});

test('malformed values are reported with the reason, not just the name', () => {
  assert.throws(
    () => loadConfig({ ...complete, DATABASE_URL: 'mysql://nope', S3_ENDPOINT: 'not-a-url' }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.issues.length, 2);
      assert.match(error.issues.join('\n'), /DATABASE_URL must be a postgres/);
      assert.match(error.issues.join('\n'), /S3_ENDPOINT must be a URL/);
      return true;
    },
  );
});

test('numeric variables are coerced and range-checked', () => {
  assert.equal(loadConfig({ ...complete, PORT: '3000' }).port, 3000);
  assert.throws(() => loadConfig({ ...complete, PORT: '70000' }), ConfigError);
  assert.throws(() => loadConfig({ ...complete, MAX_CRITIQUE_ITERATIONS: 'many' }), ConfigError);
});
