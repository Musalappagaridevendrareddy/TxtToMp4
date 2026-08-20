import type Anthropic from '@anthropic-ai/sdk';
import {
  assertNotRefused,
  defaultClient,
  MODELS,
  PlannerError,
  toolUseOf,
  type PlannerClient,
} from './client.js';
import { gatePrompt } from './prompts.js';

export const GATE_TOOL_NAME = 'gate';

const gateTool: Anthropic.Tool = {
  name: GATE_TOOL_NAME,
  description: 'Report whether this question can become a conceptual explainer video.',
  input_schema: {
    type: 'object',
    properties: {
      suitable: { type: 'boolean' },
      reason: {
        type: 'string',
        description:
          'One sentence. If unsuitable, this is shown to the user, so make it useful to them.',
      },
    },
    required: ['suitable', 'reason'],
    additionalProperties: false,
  } as Anthropic.Tool.InputSchema,
};

export interface GateResult {
  suitable: boolean;
  reason: string;
}

/**
 * Step 0: a cheap Haiku call that stops us spending Opus tokens and half an
 * hour of render time on a question that was never going to work.
 */
export async function gate(
  question: string,
  options: { client?: PlannerClient; model?: string } = {},
): Promise<GateResult> {
  const client = options.client ?? defaultClient();

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: options.model ?? MODELS.gate,
      max_tokens: 1024,
      tools: [gateTool],
      tool_choice: { type: 'tool', name: GATE_TOOL_NAME },
      messages: [{ role: 'user', content: gatePrompt(question) }],
    });
  } catch (cause) {
    throw new PlannerError('The gate call failed', 'gate', cause);
  }

  assertNotRefused(message, 'gate');

  const toolUse = toolUseOf(message, GATE_TOOL_NAME);
  if (!toolUse) throw new PlannerError('The gate returned no verdict', 'gate');

  const input = toolUse.input as Partial<GateResult>;
  if (typeof input.suitable !== 'boolean' || typeof input.reason !== 'string') {
    throw new PlannerError('The gate returned a malformed verdict', 'gate');
  }
  return { suitable: input.suitable, reason: input.reason };
}
