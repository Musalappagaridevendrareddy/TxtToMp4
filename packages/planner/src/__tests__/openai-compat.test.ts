import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAICompatClient, salvageJsonObject } from '../openai-compat.js';

/** Capture the outgoing request body and reply with a canned response. */
function stubFetch(reply: unknown, status = 200) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const impl = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init.body),
      headers: init.headers as Record<string, string>,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return reply;
      },
      async text() {
        return JSON.stringify(reply);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const chatReply = (message: unknown, finish = 'stop') => ({
  id: 'chatcmpl-1',
  model: 'local-model',
  choices: [{ message, finish_reason: finish }],
  usage: { prompt_tokens: 11, completion_tokens: 22 },
});

test('posts to /chat/completions and maps a plain text answer', async () => {
  const { impl, calls } = stubFetch(chatReply({ content: 'a hash map is a table' }));
  const client = createOpenAICompatClient({
    baseUrl: 'http://localhost:11434/v1/',
    fetchImpl: impl,
  });

  const message = await client.messages.create({
    model: 'qwen2.5:32b',
    max_tokens: 500,
    system: 'You are terse.',
    messages: [{ role: 'user', content: 'explain hash maps' }],
  } as any);

  assert.equal(calls[0]!.url, 'http://localhost:11434/v1/chat/completions');
  assert.deepEqual(calls[0]!.body.messages, [
    { role: 'system', content: 'You are terse.' },
    { role: 'user', content: 'explain hash maps' },
  ]);
  assert.equal(message.content[0]!.type, 'text');
  assert.equal(message.stop_reason, 'end_turn');
  assert.equal(message.usage.input_tokens, 11);
  assert.equal(message.usage.output_tokens, 22);
});

test('never forwards Anthropic-only parameters a local server would reject', async () => {
  const { impl, calls } = stubFetch(chatReply({ content: 'ok' }));
  const client = createOpenAICompatClient({ baseUrl: 'http://x/v1', fetchImpl: impl });

  await client.messages.create({
    model: 'm',
    max_tokens: 100,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: 'hi' }],
  } as any);

  assert.equal(calls[0]!.body.thinking, undefined);
  assert.equal(calls[0]!.body.output_config, undefined);
  assert.equal(calls[0]!.body.max_tokens, 100);
});

test('forced tool use becomes an OpenAI function call and maps back to tool_use', async () => {
  const { impl, calls } = stubFetch(
    chatReply(
      {
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'emit_video_spec', arguments: '{"topic":"x"}' },
          },
        ],
      },
      'tool_calls',
    ),
  );
  const client = createOpenAICompatClient({ baseUrl: 'http://x/v1', fetchImpl: impl });

  const message = await client.messages.create({
    model: 'm',
    max_tokens: 100,
    tools: [{ name: 'emit_video_spec', description: 'd', input_schema: { type: 'object' } }],
    tool_choice: { type: 'tool', name: 'emit_video_spec' },
    messages: [{ role: 'user', content: 'go' }],
  } as any);

  assert.deepEqual(calls[0]!.body.tool_choice, {
    type: 'function',
    function: { name: 'emit_video_spec' },
  });
  assert.equal(calls[0]!.body.tools[0].function.name, 'emit_video_spec');

  const block = message.content[0]! as any;
  assert.equal(block.type, 'tool_use');
  assert.equal(block.name, 'emit_video_spec');
  assert.deepEqual(block.input, { topic: 'x' });
  assert.equal(message.stop_reason, 'tool_use');
});

test('json_schema mode uses response_format instead of tools', async () => {
  const { impl, calls } = stubFetch(chatReply({ content: '{"topic":"y"}' }));
  const client = createOpenAICompatClient({
    baseUrl: 'http://x/v1',
    fetchImpl: impl,
    structuredOutput: 'json_schema',
  });

  const message = await client.messages.create({
    model: 'm',
    max_tokens: 100,
    tools: [{ name: 'emit_video_spec', description: 'd', input_schema: { type: 'object' } }],
    tool_choice: { type: 'tool', name: 'emit_video_spec' },
    messages: [{ role: 'user', content: 'go' }],
  } as any);

  assert.equal(calls[0]!.body.response_format.type, 'json_schema');
  assert.equal(calls[0]!.body.response_format.json_schema.name, 'emit_video_spec');
  assert.equal(calls[0]!.body.tools, undefined);
  // The bare JSON body is promoted into the tool_use block emitSpec expects.
  assert.equal((message.content[0]! as any).type, 'tool_use');
  assert.deepEqual((message.content[0]! as any).input, { topic: 'y' });
});

test('salvages a fenced JSON answer when a local model ignores tool calling', async () => {
  const { impl } = stubFetch(
    chatReply({ content: 'Sure!\n```json\n{"topic":"salvaged"}\n```\nHope that helps.' }),
  );
  const client = createOpenAICompatClient({ baseUrl: 'http://x/v1', fetchImpl: impl });

  const message = await client.messages.create({
    model: 'm',
    max_tokens: 100,
    tools: [{ name: 'emit_video_spec', description: 'd', input_schema: { type: 'object' } }],
    tool_choice: { type: 'tool', name: 'emit_video_spec' },
    messages: [{ role: 'user', content: 'go' }],
  } as any);

  const block = message.content[0]! as any;
  assert.equal(block.type, 'tool_use');
  assert.deepEqual(block.input, { topic: 'salvaged' });
});

test('strict tools mode does not salvage, so a real failure stays visible', async () => {
  const { impl } = stubFetch(chatReply({ content: '{"topic":"ignored"}' }));
  const client = createOpenAICompatClient({
    baseUrl: 'http://x/v1',
    fetchImpl: impl,
    structuredOutput: 'tools',
  });

  const message = await client.messages.create({
    model: 'm',
    max_tokens: 100,
    tools: [{ name: 'emit_video_spec', description: 'd', input_schema: { type: 'object' } }],
    tool_choice: { type: 'tool', name: 'emit_video_spec' },
    messages: [{ role: 'user', content: 'go' }],
  } as any);

  assert.ok(!message.content.some((b) => b.type === 'tool_use'));
});

test('the repair loop transcript survives translation', async () => {
  const { impl, calls } = stubFetch(chatReply({ content: 'ok' }));
  const client = createOpenAICompatClient({ baseUrl: 'http://x/v1', fetchImpl: impl });

  await client.messages.create({
    model: 'm',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'emit a spec' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_9', name: 'emit_video_spec', input: { topic: 'bad' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_9',
            content: 'beats: too few',
            is_error: true,
          },
        ],
      },
    ],
  } as any);

  const sent = calls[0]!.body.messages;
  assert.equal(sent[1].role, 'assistant');
  assert.equal(sent[1].tool_calls[0].id, 'toolu_9');
  assert.equal(sent[1].tool_calls[0].function.arguments, '{"topic":"bad"}');
  // tool_result must become its own `tool` message, not stay inline content.
  assert.equal(sent[2].role, 'tool');
  assert.equal(sent[2].tool_call_id, 'toolu_9');
  assert.equal(sent[2].content, 'beats: too few');
});

test('images become data URIs when vision is declared', async () => {
  const { impl, calls } = stubFetch(chatReply({ content: 'looks fine' }));
  const client = createOpenAICompatClient({
    baseUrl: 'http://x/v1',
    fetchImpl: impl,
    supportsVision: true,
  });

  await client.messages.create({
    model: 'm',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'check this frame' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      },
    ],
  } as any);

  const parts = calls[0]!.body.messages[0].content;
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].image_url.url, 'data:image/png;base64,AAAA');
});

test('refuses images rather than silently critiquing blind when vision is absent', async () => {
  const { impl } = stubFetch(chatReply({ content: 'x' }));
  const client = createOpenAICompatClient({ baseUrl: 'http://x/v1', fetchImpl: impl });

  await assert.rejects(
    client.messages.create({
      model: 'm',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      ],
    } as any),
    /not declared vision-capable/,
  );
});

test('an unreachable server names the address rather than leaking a fetch error', async () => {
  const impl = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const client = createOpenAICompatClient({ baseUrl: 'http://localhost:9/v1', fetchImpl: impl });

  await assert.rejects(
    client.messages.create({
      model: 'm',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    } as any),
    /Could not reach the local model server at http:\/\/localhost:9\/v1/,
  );
});

test('an HTTP error surfaces the status and body', async () => {
  const { impl } = stubFetch({ error: { message: 'model not found' } }, 404);
  const client = createOpenAICompatClient({ baseUrl: 'http://x/v1', fetchImpl: impl });

  await assert.rejects(
    client.messages.create({
      model: 'missing',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    } as any),
    /returned 404/,
  );
});

test('salvageJsonObject handles fences, preamble and junk', () => {
  assert.deepEqual(salvageJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(salvageJsonObject('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(salvageJsonObject('Here you go: {"a":3} — done'), { a: 3 });
  assert.equal(salvageJsonObject('no json here'), undefined);
  assert.equal(salvageJsonObject(''), undefined);
});
