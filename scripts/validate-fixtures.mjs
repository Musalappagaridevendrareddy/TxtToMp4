#!/usr/bin/env node
/**
 * Validates every fixture against the real parser. Fixtures are hand-written,
 * which means they are hand-broken; this is what catches that.
 *
 *   node scripts/validate-fixtures.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// pathToFileURL, not a bare path: Windows drive letters are not a URL scheme.
const { parseVideoSpec, SpecValidationError, specDuration } = await import(
  pathToFileURL(join(root, 'packages', 'spec', 'dist', 'index.js')).href
);

const fixturesDir = join(root, 'fixtures');
const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

if (files.length === 0) {
  console.error('No fixtures found.');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const raw = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  try {
    const spec = parseVideoSpec(raw);
    const archetypes = [...new Set(spec.beats.map((b) => b.archetype))].join(', ');
    console.log(
      `PASS  ${file.padEnd(24)} ${spec.beats.length} beats, ${specDuration(spec).toFixed(1)}s  [${archetypes}]`,
    );
  } catch (error) {
    failed += 1;
    if (error instanceof SpecValidationError) {
      console.error(`FAIL  ${file}`);
      for (const issue of error.issues) console.error(`        ${issue}`);
    } else {
      console.error(`FAIL  ${file}: ${error.message}`);
    }
  }
}

console.log(`\n${files.length - failed}/${files.length} fixtures valid`);
process.exit(failed === 0 ? 0 : 1);
