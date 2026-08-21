import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { parseVideoSpec, SpecValidationError, type TypedVideoSpec } from '@explainer/spec';
import {
  assertNotRefused,
  defaultClient,
  MODELS,
  PlannerError,
  textOf,
  toolUseOf,
  type PlannerClient,
} from './client.js';
import { emitSpecTool, EMIT_TOOL_NAME } from './emit.js';
import { critiqueSystemPrompt, critiqueUserPrompt } from './prompts.js';

export const VERDICT_TOOL_NAME = 'verdict';

const verdictTool: Anthropic.Tool = {
  name: VERDICT_TOOL_NAME,
  description: 'Declare the animation good enough to ship, with no changes needed.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['ship'] },
      note: { type: 'string', description: 'One sentence on why it is fine.' },
    },
    required: ['verdict'],
    additionalProperties: false,
  } as Anthropic.Tool.InputSchema,
};

export type CritiqueOutcome =
  | { verdict: 'ship'; note: string; spec: TypedVideoSpec }
  | { verdict: 'revise'; spec: TypedVideoSpec; notes: string };

export interface CritiqueOptions {
  client?: PlannerClient;
  model?: string;
}

const MEDIA_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function imageBlock(path: string): Promise<Anthropic.ImageBlockParam> {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) {
    throw new PlannerError(`Unsupported keyframe format: ${path}`, 'critique');
  }
  const data = await readFile(path);
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: data.toString('base64') },
  };
}

/**
 * Step 7: look at the rendered frames and either ship or fix the spec.
 *
 * This loop is the single biggest quality lever in the system, and also the
 * easiest to make worse — a model that feels obliged to find something will
 * always find something. The prompt says so explicitly, and "ship" is a
 * first-class tool rather than an absence of output.
 */
export async function critique(
  spec: TypedVideoSpec,
  keyframePaths: string[],
  options: CritiqueOptions = {},
): Promise<CritiqueOutcome> {
  if (keyframePaths.length === 0) {
    throw new PlannerError('critique() was given no keyframes', 'critique');
  }

  const client = options.client ?? defaultClient();
  const images = await Promise.all(keyframePaths.map(imageBlock));
  const beatIds = spec.beats.map((b) => b.id);

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: options.model ?? MODELS.critique,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: critiqueSystemPrompt(),
      tools: [emitSpecTool, verdictTool],
      messages: [
        {
          role: 'user',
          content: [...images, { type: 'text', text: critiqueUserPrompt(spec.topic, beatIds, spec) }],
        },
      ],
    });
  } catch (cause) {
    throw new PlannerError('The critique call failed', 'critique', cause);
  }

  assertNotRefused(message, 'critique');

  const shipped = toolUseOf(message, VERDICT_TOOL_NAME);
  if (shipped) {
    const note = (shipped.input as { note?: string }).note ?? 'No defects found.';
    return { verdict: 'ship', note, spec };
  }

  const revised = toolUseOf(message, EMIT_TOOL_NAME);
  if (!revised) {
    // No tool call at all means the critic had nothing actionable to say.
    // Treat that as ship rather than burning another render iteration.
    return { verdict: 'ship', note: textOf(message) || 'No revision proposed.', spec };
  }

  try {
    return { verdict: 'revise', spec: parseVideoSpec(revised.input), notes: textOf(message) };
  } catch (error) {
    if (!(error instanceof SpecValidationError)) throw error;
    // A revision we cannot render is worse than no revision. Keep what works.
    return {
      verdict: 'ship',
      note: `Critic proposed an invalid revision (${error.issues.length} issue(s)); keeping the current spec.`,
      spec,
    };
  }
}
