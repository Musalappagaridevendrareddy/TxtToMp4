import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVideoSpec, SpecValidationError, specDuration, type VideoSpec } from './schema.js';
import { specHash } from './hash.js';
import { ARCHETYPE_NAMES } from './archetypes.js';

/** A minimal spec that passes. Tests mutate a clone of this. */
function baseSpec(): VideoSpec {
  return {
    topic: 'How does a hash map work?',
    arc: 'walkthrough',
    palette: 'cool',
    pacing: 'deliberate',
    totalDurationTarget: 30,
    beats: [
      {
        id: 'hook',
        narration: 'A word becomes an index.',
        durationSeconds: 8.5,
        archetype: 'transformation',
        params: { before: { label: 'word' }, after: { label: 'index' }, via: 'hashing' },
        emphasis: ['index'],
        emotion: 'curious',
        holdAfterSeconds: 1.5,
      },
      {
        id: 'middle',
        narration: 'Every key lands in one bucket.',
        durationSeconds: 8.5,
        archetype: 'fan_out',
        params: {
          source: { label: 'hash' },
          targets: [{ label: 'Bucket 0' }, { label: 'Bucket 1' }],
        },
        emphasis: ['one bucket'],
        emotion: 'neutral',
        holdAfterSeconds: 1.5,
      },
      {
        id: 'payoff',
        narration: 'One jump, not a thousand checks.',
        durationSeconds: 8.5,
        archetype: 'transformation',
        params: { before: { label: '1000 checks' }, after: { label: '1 jump' } },
        emphasis: ['One jump'],
        emotion: 'emphatic',
        holdAfterSeconds: 1.5,
      },
    ],
  } as VideoSpec;
}

function issuesFor(spec: unknown): string[] {
  try {
    parseVideoSpec(spec);
    return [];
  } catch (error) {
    assert.ok(error instanceof SpecValidationError, `expected SpecValidationError, got ${error}`);
    return error.issues;
  }
}

test('a well-formed spec parses and narrows params to the archetype', () => {
  const spec = parseVideoSpec(baseSpec());
  assert.equal(spec.beats.length, 3);
  const first = spec.beats[0]!;
  assert.equal(first.archetype, 'transformation');
  if (first.archetype === 'transformation') {
    // Narrowed: this would not typecheck if params were still unknown.
    assert.equal(first.params.before.label, 'word');
  }
});

test('every archetype name has a params schema', () => {
  // Guards against adding a name without its schema, which would otherwise only
  // show up at render time on a real user's video.
  for (const name of ARCHETYPE_NAMES) {
    const spec = baseSpec();
    spec.beats[0]!.archetype = name;
    spec.beats[0]!.params = {};
    const issues = issuesFor(spec);
    assert.ok(
      issues.some((i) => i.includes(`(${name}) params.`)),
      `${name} produced no params issues for an empty params object: ${issues.join(' | ')}`,
    );
  }
});

test('narration that cannot be spoken in the beat is rejected', () => {
  const spec = baseSpec();
  spec.beats[0]!.durationSeconds = 2;
  spec.beats[0]!.narration =
    'This sentence is far too long to be spoken aloud in two seconds by any narrator alive today, and it keeps going well past the point of reason.';
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('will not fit in 2s')));
});

test('emphasis that does not appear in the narration is rejected', () => {
  const spec = baseSpec();
  spec.beats[0]!.emphasis = ['bucket'];
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('does not appear in this beat')));
});

test('emphasis matching is case-insensitive', () => {
  const spec = baseSpec();
  spec.beats[0]!.emphasis = ['INDEX'];
  assert.equal(issuesFor(spec).length, 0);
});

test('duplicate beat ids are rejected', () => {
  const spec = baseSpec();
  spec.beats[1]!.id = 'hook';
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('duplicate beat id')));
});

test('fan_out highlightIndex must exist among the targets', () => {
  const spec = baseSpec();
  spec.beats[1]!.params = {
    source: { label: 'hash' },
    targets: [{ label: 'Bucket 0' }, { label: 'Bucket 1' }],
    highlightIndex: 3,
  };
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('out of range')));
});

test('spatial_map edges must reference real nodes and cannot be self-loops', () => {
  const spec = baseSpec();
  spec.beats[1]!.archetype = 'spatial_map';
  spec.beats[1]!.params = {
    nodes: [
      { label: 'A', x: 0.1, y: 0.5 },
      { label: 'B', x: 0.9, y: 0.5 },
    ],
    edges: [
      { from: 0, to: 4 },
      { from: 1, to: 1 },
    ],
  };
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('node index that does not exist')));
  assert.ok(issues.some((i) => i.includes('start and end at the same node')));
});

test('accumulation magnitudes must not decrease', () => {
  const spec = baseSpec();
  spec.beats[1]!.archetype = 'accumulation';
  spec.beats[1]!.params = {
    subject: { label: 'Balance' },
    stages: [
      { label: 'Year 1', magnitude: 0.8 },
      { label: 'Year 2', magnitude: 0.2 },
    ],
  };
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('must not decrease')));
});

test('total duration must land near the target', () => {
  const spec = baseSpec();
  spec.totalDurationTarget = 180;
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('totalDurationTarget')));
});

test('a target below the 30s floor is rejected outright', () => {
  // A 20-second "explainer" is a clip, not an explanation.
  const spec = baseSpec();
  spec.totalDurationTarget = 20;
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('totalDurationTarget: Number must be greater')));
});

test('labels longer than the cap are rejected', () => {
  const spec = baseSpec();
  spec.beats[0]!.params = {
    before: { label: 'a label far longer than twenty eight characters' },
    after: { label: 'index' },
  };
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('params.before.label')));
});

test('beat ids must be lowercase slugs', () => {
  const spec = baseSpec();
  spec.beats[0]!.id = 'Hook Beat';
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('kebab/snake case')));
});

test('an unknown archetype is rejected by the envelope', () => {
  const spec = baseSpec() as unknown as { beats: { archetype: string }[] };
  spec.beats[0]!.archetype = 'explosion';
  const issues = issuesFor(spec);
  assert.ok(issues.some((i) => i.includes('beats.0.archetype')));
});

test('specDuration counts holds as well as speech', () => {
  assert.equal(specDuration(baseSpec()), 8.5 * 3 + 1.5 * 3);
});

test('specHash ignores key order but not values', () => {
  const a = { topic: 'x', beats: [{ id: 'one', durationSeconds: 4 }] };
  const b = { beats: [{ durationSeconds: 4, id: 'one' }], topic: 'x' };
  const c = { topic: 'x', beats: [{ id: 'one', durationSeconds: 5 }] };
  assert.equal(specHash(a), specHash(b));
  assert.notEqual(specHash(a), specHash(c));
});
