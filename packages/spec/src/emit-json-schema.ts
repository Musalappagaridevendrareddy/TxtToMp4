/**
 * Writes the JSON Schemas to packages/spec/schemas/ so the Python renderer can
 * validate the same contract without a TypeScript dependency.
 *
 *   npm run -w @explainer/spec build && npm run -w @explainer/spec emit-json-schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPE_NAMES } from './archetypes.js';
import { archetypeParamsJsonSchemas, videoSpecJsonSchema } from './json-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schemas');

mkdirSync(join(outDir, 'archetypes'), { recursive: true });
writeFileSync(join(outDir, 'video-spec.json'), `${JSON.stringify(videoSpecJsonSchema, null, 2)}\n`);

for (const name of ARCHETYPE_NAMES) {
  writeFileSync(
    join(outDir, 'archetypes', `${name}.json`),
    `${JSON.stringify(archetypeParamsJsonSchemas[name], null, 2)}\n`,
  );
}

console.log(`wrote video-spec.json and ${ARCHETYPE_NAMES.length} archetype schemas to ${outDir}`);
