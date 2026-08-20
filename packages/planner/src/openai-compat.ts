import type Anthropic from '@anthropic-ai/sdk';

import { PlannerError } from './client.js';

/**
 * A `PlannerClient` backed by any OpenAI-compatible `/chat/completions`
 * endpoint, so the four decision stages can run on a locally hosted model.
 *
 * Why this shape: `PlannerClient` is already the Anthropic Messages surface,
 * and `plan`/`emit`/`critique`/`gate` are written against it. Translating here
 * rather than abstracting there leaves those stages untouched and gives
 * provider differences exactly one place to hide.
 *
 * Known to speak this protocol: Ollama (`/v1`), vLLM, llama.cpp's server,
 * LM Studio, and text-generation-inference.
 *
 * The hard part is not chat — it is that `emitSpec` relies on *forced* tool
 * use to get a schema-valid object out. Local servers vary: some implement
 * OpenAI tool calling, some only implement `response_format`, and smaller
 * models often narrate around the JSON rather than emitting it cleanly. All
 * three cases are handled below; see `structuredOutput`.
 */

export type StructuredOutputMode = 'tools' | 'json_schema' | 'auto';

export interface OpenAICompatOptions {
  /** Root of the OpenAI-compatible API, e.g. `http://localhost:11434/v1`. */
  baseUrl: string;
  /** Most local servers ignore this; it is sent anyway for the ones that don't. */
  apiKey?: string;
  /**
   * How to force structured output.
   *  - `tools`       OpenAI function calling. Best when the server supports it.
   *  - `json_schema` `response_format` with a JSON schema — constrained
   *                  decoding on vLLM/llama.cpp, usually the most reliable
   *                  option for smaller local models.
   *  - `auto`        ask for tools, and fall back to parsing the message body
   *                  when the model answers with bare JSON instead. Default.
   */
  structuredOutput?: StructuredOutputMode;
  /**
   * Whether the configured critique model can read images. Defaults to false:
   * most local text models cannot, and a critique that silently stops looking
   * at the frames is worse than one that refuses to run.
   */
  supportsVision?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

/* ------------------------------------------------------------------ *
 * Anthropic request  ->  OpenAI request
 * ------------------------------------------------------------------ */

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>> | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** Anthropic keeps text and images in one array; OpenAI splits by role and part type. */
function toOpenAIContent(
  blocks: Anthropic.ContentBlockParam[],
  supportsVision: boolean,
): { parts: Array<Record<string, unknown>>; toolCalls: OpenAIToolCall[] } {
  const parts: Array<Record<string, unknown>> = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;

      case 'image': {
        if (!supportsVision) {
          throw new PlannerError(
            'The configured local model was not declared vision-capable, but the critique ' +
              'stage sends rendered keyframes. Either point CRITIQUE_MODEL at a vision model ' +
              'and set LLM_VISION=1, or disable the loop with MAX_CRITIQUE_ITERATIONS=0.',
            'critique',
          );
        }
        // OpenAI carries images as data URIs rather than a typed source object.
        const source = block.source;
        if (source.type !== 'base64') {
          throw new PlannerError(
            `Only base64 image sources are supported over the OpenAI-compatible protocol, got "${source.type}"`,
            'critique',
          );
        }
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${source.media_type};base64,${source.data}` },
        });
        break;
      }

      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
        break;

      case 'tool_result':
        // Handled by the caller: it becomes its own `role: "tool"` message.
        break;

      default:
        // thinking / redacted_thinking and anything newer have no OpenAI
        // equivalent. Dropping them is correct — they are Anthropic-internal.
        break;
    }
  }

  return { parts, toolCalls };
}

function toOpenAIMessages(
  system: Anthropic.MessageCreateParamsNonStreaming['system'],
  messages: Anthropic.MessageParam[],
  supportsVision: boolean,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  if (typeof system === 'string' && system.trim()) {
    out.push({ role: 'system', content: system });
  } else if (Array.isArray(system)) {
    const text = system
      .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n');
    if (text.trim()) out.push({ role: 'system', content: text });
  }

  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    // tool_result blocks must leave the array and become their own messages,
    // because OpenAI models them as a distinct role rather than as content.
    const toolResults = message.content.filter(
      (b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result',
    );
    for (const result of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content:
          typeof result.content === 'string'
            ? result.content
            : (result.content ?? [])
                .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
                .map((b) => b.text)
                .join('\n'),
      });
    }

    const rest = message.content.filter((b) => b.type !== 'tool_result');
    if (rest.length === 0) continue;

    const { parts, toolCalls } = toOpenAIContent(rest, supportsVision);
    const entry: OpenAIMessage = {
      role: message.role,
      // A single text part is sent as a plain string: some servers reject the
      // array form on assistant turns.
      content:
        parts.length === 0
          ? null
          : parts.length === 1 && parts[0]!.type === 'text'
            ? String(parts[0]!.text)
            : parts,
    };
    if (toolCalls.length > 0) entry.tool_calls = toolCalls;
    out.push(entry);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * OpenAI response  ->  Anthropic response
 * ------------------------------------------------------------------ */

const STOP_REASONS: Record<string, Anthropic.Message['stop_reason']> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'refusal',
};

/**
 * Recover a JSON object from a model that answered with prose around it.
 *
 * Local models frequently wrap the object in a ```json fence or a sentence of
 * preamble. The strict paths (tool calling, constrained decoding) run first;
 * this only fires when they produced nothing, and returning undefined is not
 * fatal — the caller raises a clear error instead.
 */
export function salvageJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

interface OpenAIChoice {
  message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
  finish_reason?: string;
}

interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function toAnthropicMessage(
  response: OpenAIResponse,
  requestedModel: string,
  forcedToolName: string | undefined,
): Anthropic.Message {
  const choice = response.choices?.[0];
  const content: Anthropic.ContentBlock[] = [];

  const text = choice?.message?.content ?? '';
  const toolCalls = choice?.message?.tool_calls ?? [];

  for (const call of toolCalls) {
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      // A malformed argument string is a model failure, not a transport one;
      // surface it as an empty input so the validator reports the real issues.
      input = {};
    }
    content.push({
      type: 'tool_use',
      id: call.id || `toolu_${Math.random().toString(36).slice(2)}`,
      name: call.function.name,
      input,
    } as Anthropic.ToolUseBlock);
  }

  // Forced tool use that came back as bare JSON in the body: synthesise the
  // tool_use block the caller is looking for.
  if (forcedToolName && toolCalls.length === 0 && text) {
    const salvaged = salvageJsonObject(text);
    if (salvaged !== undefined) {
      content.push({
        type: 'tool_use',
        id: `toolu_salvaged_${Math.random().toString(36).slice(2)}`,
        name: forcedToolName,
        input: salvaged,
      } as Anthropic.ToolUseBlock);
    }
  }

  if (text && content.length === 0) {
    content.push({ type: 'text', text, citations: null } as unknown as Anthropic.TextBlock);
  }

  const finish = choice?.finish_reason ?? 'stop';
  const stopReason = content.some((b) => b.type === 'tool_use')
    ? 'tool_use'
    : (STOP_REASONS[finish] ?? 'end_turn');

  return {
    id: response.id ?? `msg_local_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: response.model ?? requestedModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    // `stop_details` is only populated on refusals upstream; mirror that.
    ...(stopReason === 'refusal'
      ? { stop_details: { type: 'refusal', category: 'content_filter', explanation: null } }
      : {}),
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  } as unknown as Anthropic.Message;
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export function createOpenAICompatClient(options: OpenAICompatOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const mode: StructuredOutputMode = options.structuredOutput ?? 'auto';
  const supportsVision = options.supportsVision ?? false;
  const timeoutMs = options.requestTimeoutMs ?? 10 * 60_000;

  if (!doFetch) {
    throw new PlannerError('No fetch implementation available (Node 18+ required)', 'plan');
  }

  return {
    messages: {
      async create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        const forced =
          params.tool_choice && params.tool_choice.type === 'tool'
            ? params.tool_choice.name
            : undefined;

        const body: Record<string, unknown> = {
          model: params.model,
          messages: toOpenAIMessages(params.system, params.messages, supportsVision),
          max_tokens: params.max_tokens,
        };

        // `thinking` and `output_config.effort` are Anthropic-only and are
        // deliberately not forwarded; local servers reject unknown fields.

        const forcedTool = forced
          ? params.tools?.find((t): t is Anthropic.Tool => 'name' in t && t.name === forced)
          : undefined;

        const useJsonSchema = mode === 'json_schema' && forcedTool;

        if (useJsonSchema) {
          body.response_format = {
            type: 'json_schema',
            json_schema: {
              name: forcedTool.name,
              schema: forcedTool.input_schema,
              strict: true,
            },
          };
        } else if (params.tools?.length) {
          body.tools = params.tools
            .filter((t): t is Anthropic.Tool => 'name' in t && 'input_schema' in t)
            .map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description ?? '',
                parameters: t.input_schema,
              },
            }));
          if (forced) {
            body.tool_choice = { type: 'function', function: { name: forced } };
          }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;
        try {
          response = await doFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (cause) {
          throw new PlannerError(
            `Could not reach the local model server at ${base}. Is it running?`,
            'plan',
            cause,
          );
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new PlannerError(
            `Local model server returned ${response.status}: ${detail.slice(0, 500)}`,
            'plan',
          );
        }

        const json = (await response.json()) as OpenAIResponse;
        if (json.error) {
          throw new PlannerError(`Local model server error: ${json.error.message}`, 'plan');
        }

        // In strict `tools` mode a missing tool call is a real failure worth
        // reporting, so salvage is disabled there.
        return toAnthropicMessage(json, params.model, mode === 'tools' ? undefined : forced);
      },
    },
  };
}
