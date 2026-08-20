import { type ArchetypeName } from './archetypes.js';
/**
 * The JSON Schema handed to Claude as the `emit_video_spec` tool input.
 *
 * `params` stays a free-form object here on purpose: a discriminated union of
 * twelve param shapes is large enough to hurt the model's reasoning, and we
 * validate params properly on our side anyway. The system prompt carries the
 * per-archetype shapes instead, as worked examples.
 */
export declare const videoSpecJsonSchema: import("zod-to-json-schema").JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?: {
        [key: string]: import("zod-to-json-schema").JsonSchema7Type;
    } | undefined;
};
/** Per-archetype params schemas, used to build the prompt's archetype catalog. */
export declare const archetypeParamsJsonSchemas: Record<ArchetypeName, unknown>;
