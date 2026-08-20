import type Anthropic from '@anthropic-ai/sdk';
import type { PlannerClient } from '../client.js';

export interface RecordedCall {
  params: Anthropic.MessageCreateParamsNonStreaming;
}

/**
 * A scripted stand-in for the Anthropic client. Each queued response is
 * returned in order; the calls are recorded so tests can assert on what was
 * actually sent (tool_choice, system prompt, repair transcript).
 */
export class FakeClient implements PlannerClient {
  readonly calls: RecordedCall[] = [];
  private readonly queue: Anthropic.Message[];

  constructor(responses: Anthropic.Message[]) {
    this.queue = [...responses];
  }

  readonly messages = {
    create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      this.calls.push({ params });
      const next = this.queue.shift();
      if (!next) throw new Error('FakeClient ran out of scripted responses');
      return next;
    },
  };
}

let counter = 0;

export function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  counter += 1;
  return {
    id: `msg_${counter}`,
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content: [{ type: 'tool_use', id: `toolu_${counter}`, name, input } as Anthropic.ToolUseBlock],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Anthropic.Message;
}

export function textMessage(text: string): Anthropic.Message {
  counter += 1;
  return {
    id: `msg_${counter}`,
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content: [{ type: 'text', text, citations: null } as unknown as Anthropic.TextBlock],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Anthropic.Message;
}

export function refusalMessage(category: string): Anthropic.Message {
  counter += 1;
  return {
    id: `msg_${counter}`,
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content: [],
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category, explanation: 'declined' },
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}
