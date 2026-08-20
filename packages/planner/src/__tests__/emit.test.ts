import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PlannerError } from '../client.js';
import { emitSpec, EMIT_TOOL_NAME } from '../emit.js';
import { gate, GATE_TOOL_NAME } from '../gate.js';
import { plan } from '../plan.js';
import { archetypeCatalog, specSystemPrompt } from '../prompts.js';
import { FakeClient, refusalMessage, textMessage, toolUseMessage } from './fake-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', '..', '..', 'fixtures');

function validSpec(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixturesDir, 'hashmap.json'), 'utf8'));
}

test('emitSpec returns on the first valid spec', async () => {
  const client = new FakeClient([toolUseMessage(EMIT_TOOL_NAME, validSpec())]);
  const result = await emitSpec('How does a hash map work?', 'some reasoning', { client });

  assert.equal(result.attempts, 1);
  assert.deepEqual(result.repairs, []);
  assert.equal(result.spec.beats.length, 7);
});

test('emitSpec forces the tool and sends the archetype catalog', async () => {
  const client = new FakeClient([toolUseMessage(EMIT_TOOL_NAME, validSpec())]);
  await emitSpec('q', 'plan', { client });

  const params = client.calls[0]!.params;
  assert.deepEqual(params.tool_choice, { type: 'tool', name: EMIT_TOOL_NAME });
  assert.equal(params.tools?.length, 1);
  assert.ok(typeof params.system === 'string' && params.system.includes('### transformation'));
});

test('emitSpec feeds validation issues back and succeeds on the retry', async () => {
  const broken = validSpec();
  (broken.beats as Record<string, unknown>[])[0]!.emphasis = ['not in the narration'];

  const client = new FakeClient([
    toolUseMessage(EMIT_TOOL_NAME, broken),
    toolUseMessage(EMIT_TOOL_NAME, validSpec()),
  ]);

  const attempts: number[] = [];
  const result = await emitSpec('q', 'plan', { client, onAttempt: (n) => attempts.push(n) });

  assert.equal(result.attempts, 2);
  assert.equal(result.repairs.length, 1);
  assert.ok(result.repairs[0]!.some((i) => i.includes('does not appear in this beat')));
  assert.deepEqual(attempts, [1, 2]);

  // The second call must carry the rejected attempt plus the validator's words.
  const second = client.calls[1]!.params;
  assert.equal(second.messages.length, 3);
  assert.equal(second.messages[1]!.role, 'assistant');
  const repair = second.messages[2]!.content;
  assert.ok(Array.isArray(repair));
  const block = repair[0] as { type: string; is_error?: boolean; content?: string };
  assert.equal(block.type, 'tool_result');
  assert.equal(block.is_error, true);
  assert.ok(block.content?.includes('does not appear in this beat'));
});

test('emitSpec gives up after maxAttempts and reports every issue', async () => {
  const broken = validSpec();
  (broken.beats as Record<string, unknown>[])[0]!.emphasis = ['nope'];

  const client = new FakeClient([
    toolUseMessage(EMIT_TOOL_NAME, broken),
    toolUseMessage(EMIT_TOOL_NAME, broken),
    toolUseMessage(EMIT_TOOL_NAME, broken),
  ]);

  await assert.rejects(
    () => emitSpec('q', 'plan', { client, maxAttempts: 3 }),
    (error: unknown) => {
      assert.ok(error instanceof PlannerError);
      assert.equal(error.stage, 'spec');
      assert.ok(error.message.includes('invalid spec 3 times'));
      return true;
    },
  );
  assert.equal(client.calls.length, 3);
});

test('emitSpec fails loudly when the model returns no tool call', async () => {
  const client = new FakeClient([textMessage('here is a spec, i promise')]);
  await assert.rejects(() => emitSpec('q', 'plan', { client }), /no emit_video_spec call/);
});

test('a refusal is reported as a refusal, not a parse error', async () => {
  const client = new FakeClient([refusalMessage('cyber')]);
  await assert.rejects(
    () => emitSpec('q', 'plan', { client }),
    (error: unknown) => {
      assert.ok(error instanceof PlannerError);
      assert.ok(error.message.includes('declined'));
      assert.ok(error.message.includes('cyber'));
      return true;
    },
  );
});

test('plan returns the prose and asks for no JSON', async () => {
  const client = new FakeClient([textMessage('The shape of this concept is a transformation.')]);
  const prose = await plan('How does a hash map work?', { client });

  assert.match(prose, /transformation/);
  const sent = client.calls[0]!.params.messages[0]!.content as string;
  assert.ok(sent.includes('Do not write JSON'));
  assert.equal(client.calls[0]!.params.tools, undefined);
});

test('plan rejects an empty response rather than passing it downstream', async () => {
  const client = new FakeClient([textMessage('')]);
  await assert.rejects(() => plan('q', { client }), /no reasoning/);
});

test('gate parses a verdict', async () => {
  const client = new FakeClient([
    toolUseMessage(GATE_TOOL_NAME, { suitable: false, reason: 'This asks for live data.' }),
  ]);
  const result = await gate('What is the weather today?', { client });
  assert.equal(result.suitable, false);
  assert.match(result.reason, /live data/);
});

test('gate rejects a malformed verdict', async () => {
  const client = new FakeClient([toolUseMessage(GATE_TOOL_NAME, { suitable: 'yes' })]);
  await assert.rejects(() => gate('q', { client }), /malformed verdict/);
});

test('the archetype catalog covers every archetype with a worked example', () => {
  const catalog = archetypeCatalog();
  for (const name of [
    'sequence',
    'branch',
    'containment',
    'transformation',
    'fan_out',
    'layered_build',
    'zoom_detail',
    'parallel_race',
    'accumulation',
    'cycle',
    'spatial_map',
    'reveal_conceal',
  ]) {
    assert.ok(catalog.includes(`### ${name}`), `catalog is missing ${name}`);
  }
  // One worked example per archetype.
  assert.equal(catalog.split('worked example:').length - 1, 12);
});

test('the system prompt states the rules the validator actually enforces', () => {
  const prompt = specSystemPrompt();
  for (const rule of ['5 elements', '28 characters', '3 words per second', 'verbatim', '25%']) {
    assert.ok(prompt.includes(rule), `system prompt does not mention: ${rule}`);
  }
});
