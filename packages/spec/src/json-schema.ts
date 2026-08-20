import { zodToJsonSchema } from 'zod-to-json-schema';
import { ARCHETYPE_NAMES, ArchetypeParams, type ArchetypeName } from './archetypes.js';
import { VideoSpec } from './schema.js';

/**
 * The JSON Schema handed to Claude as the `emit_video_spec` tool input.
 *
 * `params` stays a free-form object here on purpose: a discriminated union of
 * twelve param shapes is large enough to hurt the model's reasoning, and we
 * validate params properly on our side anyway. The system prompt carries the
 * per-archetype shapes instead, as worked examples.
 */
export const videoSpecJsonSchema = zodToJsonSchema(VideoSpec, {
  name: 'VideoSpec',
  $refStrategy: 'none',
  target: 'jsonSchema7',
});

/** Per-archetype params schemas, used to build the prompt's archetype catalog. */
export const archetypeParamsJsonSchemas: Record<ArchetypeName, unknown> = Object.fromEntries(
  ARCHETYPE_NAMES.map((name) => [
    name,
    zodToJsonSchema(ArchetypeParams[name], { $refStrategy: 'none', target: 'jsonSchema7' }),
  ]),
) as Record<ArchetypeName, unknown>;
