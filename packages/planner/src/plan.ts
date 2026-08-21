import {
  assertNotRefused,
  defaultClient,
  MODELS,
  PlannerError,
  textOf,
  type PlannerClient,
} from './client.js';
import { plannerPrompt, type Source } from './prompts.js';

export interface PlanOptions {
  client?: PlannerClient;
  model?: string;
  /** Higher effort buys better concept decomposition; this is worth paying for. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * Text extracted from files the user uploaded. Evidence alongside the
   * question, never a replacement for it — see `sourcesSection`.
   */
  sources?: readonly Source[];
}

/**
 * Step 1 of the pipeline: reason about the concept in prose.
 *
 * Deliberately separate from spec emission. Forcing structured output in the
 * same call measurably degrades the reasoning, and the reasoning is the part
 * that decides whether the video is any good.
 */
export async function plan(question: string, options: PlanOptions = {}): Promise<string> {
  const client = options.client ?? defaultClient();

  let message;
  try {
    message = await client.messages.create({
      model: options.model ?? MODELS.planner,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: options.effort ?? 'high' },
      messages: [{ role: 'user', content: plannerPrompt(question, options.sources ?? []) }],
    });
  } catch (cause) {
    throw new PlannerError('The planner call failed', 'plan', cause);
  }

  assertNotRefused(message, 'plan');

  const prose = textOf(message);
  if (prose.length === 0) {
    throw new PlannerError('The planner returned no reasoning', 'plan');
  }
  return prose;
}
