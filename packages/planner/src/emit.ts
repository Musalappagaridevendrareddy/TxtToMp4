import type Anthropic from '@anthropic-ai/sdk';
import {
  parseVideoSpec,
  SpecValidationError,
  videoSpecJsonSchema,
  type TypedVideoSpec,
} from '@explainer/spec';
import {
  assertNotRefused,
  defaultClient,
  MODELS,
  PlannerError,
  toolUseOf,
  type PlannerClient,
} from './client.js';
import { specRepairPrompt, specSystemPrompt, specUserPrompt, type Source } from './prompts.js';

export const EMIT_TOOL_NAME = 'emit_video_spec';

/**
 * Forced tool use, not "please return JSON". The schema is generated from the
 * same Zod definitions the validator uses, so the model is never shown a
 * contract the renderer would reject.
 */
export const emitSpecTool: Anthropic.Tool = {
  name: EMIT_TOOL_NAME,
  description: 'Emit the complete specification for the explainer video.',
  input_schema: videoSpecJsonSchema as Anthropic.Tool.InputSchema,
};

export interface EmitOptions {
  client?: PlannerClient;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Validation-failure retries. Three is enough; a fourth never helps. */
  maxAttempts?: number;
  /** Called once per attempt so callers can log the repair loop. */
  onAttempt?: (attempt: number, previousIssues: string[]) => void;
  /** Uploaded-file text, carried alongside the question. */
  sources?: readonly Source[];
}

export interface EmitResult {
  spec: TypedVideoSpec;
  /** How many emitter calls it took, including the successful one. */
  attempts: number;
  /** Validation issues from each failed attempt, oldest first. */
  repairs: string[][];
}

/**
 * Step 2: turn the planner's prose into a spec the renderer will accept.
 *
 * On a validation failure the error text goes straight back to the model as a
 * repair instruction. This is the whole retry strategy — the validator already
 * writes its messages to be read by the thing that made the mistake.
 */
export async function emitSpec(
  question: string,
  planText: string,
  options: EmitOptions = {},
): Promise<EmitResult> {
  const client = options.client ?? defaultClient();
  const maxAttempts = options.maxAttempts ?? 3;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: specUserPrompt(question, planText, options.sources ?? []) },
  ];
  const repairs: string[][] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onAttempt?.(attempt, repairs.at(-1) ?? []);

    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: options.model ?? MODELS.spec,
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        output_config: { effort: options.effort ?? 'high' },
        system: specSystemPrompt(),
        tools: [emitSpecTool],
        tool_choice: { type: 'tool', name: EMIT_TOOL_NAME },
        messages,
      });
    } catch (cause) {
      throw new PlannerError('The spec emitter call failed', 'spec', cause);
    }

    assertNotRefused(message, 'spec');

    const toolUse = toolUseOf(message, EMIT_TOOL_NAME);
    if (!toolUse) {
      throw new PlannerError(
        `The spec emitter returned no ${EMIT_TOOL_NAME} call despite forced tool use`,
        'spec',
      );
    }

    try {
      const spec = parseVideoSpec(toolUse.input);
      return { spec, attempts: attempt, repairs };
    } catch (error) {
      if (!(error instanceof SpecValidationError)) throw error;
      repairs.push(error.issues);

      if (attempt === maxAttempts) {
        throw new PlannerError(
          `The spec emitter produced an invalid spec ${maxAttempts} times. Last issues:\n${error.issues
            .map((i) => `  - ${i}`)
            .join('\n')}`,
          'spec',
          error,
        );
      }

      // Keep the rejected attempt in the transcript so the model can see what
      // it did, then hand it the validator's own words.
      messages.push({ role: 'assistant', content: message.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: specRepairPrompt(error.issues),
            is_error: true,
          },
        ],
      });
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new PlannerError('The spec emitter loop exited without a result', 'spec');
}
