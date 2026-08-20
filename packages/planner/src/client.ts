import Anthropic from '@anthropic-ai/sdk';

// Circular by design: openai-compat.ts imports PlannerError from here. Safe
// because both sides only touch the imported binding inside function bodies,
// never at module evaluation time.
import { createOpenAICompatClient } from './openai-compat.js';

/**
 * Model routing. Each stage gets the cheapest model that can do its job well;
 * the two that decide what the video *is* get the most capable one.
 */
export const MODELS = {
  /** Is this even a visualizable question? */
  gate: process.env.GATE_MODEL ?? 'claude-haiku-4-5',
  /** Reasons about the concept in prose. */
  planner: process.env.PLANNER_MODEL ?? 'claude-opus-5',
  /** Turns that reasoning into a validated spec. */
  spec: process.env.SPEC_MODEL ?? 'claude-opus-5',
  /** Looks at keyframes and finds layout defects. */
  critique: process.env.CRITIQUE_MODEL ?? 'claude-sonnet-5',
} as const;

/**
 * The subset of the SDK this package uses. Narrow on purpose: the tests inject
 * a fake, and a narrow surface means the fake cannot drift from reality.
 */
export interface MessagesClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface PlannerClient {
  messages: MessagesClient;
}

let cached: PlannerClient | undefined;

/** Where the four decision stages run. */
export type LlmProvider = 'anthropic' | 'openai-compat';

export function configuredProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  if (raw === 'anthropic') return 'anthropic';
  if (raw === 'openai-compat' || raw === 'openai' || raw === 'local') return 'openai-compat';
  throw new PlannerError(
    `Unknown LLM_PROVIDER "${raw}". Use "anthropic" or "openai-compat".`,
    'plan',
  );
}

/**
 * The real client.
 *
 * With the default provider, credentials resolve from the environment the way
 * the SDK always does — ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
 * `ant auth login` profile — so an unset API key does not by itself mean
 * unauthenticated.
 *
 * Set `LLM_PROVIDER=openai-compat` to run the decision stages on a locally
 * hosted model instead; see `openai-compat.ts`. This is the only place that
 * chooses a provider, so all four stages inherit it.
 */
export function defaultClient(): PlannerClient {
  if (cached) return cached;

  if (configuredProvider() === 'openai-compat') {
    const baseUrl = process.env.LLM_BASE_URL;
    if (!baseUrl) {
      throw new PlannerError(
        'LLM_PROVIDER=openai-compat requires LLM_BASE_URL, e.g. http://localhost:11434/v1',
        'plan',
      );
    }
    cached = createOpenAICompatClient({
      baseUrl,
      ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
      structuredOutput:
        (process.env.LLM_STRUCTURED_OUTPUT as 'tools' | 'json_schema' | 'auto' | undefined) ??
        'auto',
      supportsVision: process.env.LLM_VISION === '1',
    });
    return cached;
  }

  cached = new Anthropic();
  return cached;
}

/** Test seam: forget the memoised client so an env change takes effect. */
export function resetClientCache(): void {
  cached = undefined;
}

export class PlannerError extends Error {
  constructor(
    message: string,
    readonly stage: 'gate' | 'plan' | 'spec' | 'critique',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PlannerError';
  }
}

/** Concatenate every text block in a response. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** First tool_use block with the given name, or undefined. */
export function toolUseOf(
  message: Anthropic.Message,
  name: string,
): Anthropic.ToolUseBlock | undefined {
  return message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === name,
  );
}

/**
 * A refusal is a successful HTTP 200 whose content is empty or partial.
 * Reading content[0] without checking this is how you get a confusing crash.
 */
export function assertNotRefused(message: Anthropic.Message, stage: PlannerError['stage']): void {
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ?? 'unspecified';
    throw new PlannerError(
      `The model declined this request (category: ${category}). Nothing was generated.`,
      stage,
    );
  }
}
