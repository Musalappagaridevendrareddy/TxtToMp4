import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBeatPlan, buildFramePlan, secondsToFrames } from '../lib/frames';
import type { ExplainerTimeline } from '../lib/props';
import { SAMPLE_PROPS } from '../lib/fixture';
import { TIMING } from '../theme';

function timeline(
  fps: number,
  totalSeconds: number,
  beats: { beatId: string; startSeconds: number; audioSeconds: number; holdSeconds: number }[],
): ExplainerTimeline {
  return { fps, totalSeconds, beats: beats.map((b) => ({ ...b, words: [] })) };
}

test('secondsToFrames rounds half-up and never drifts', () => {
  assert.equal(secondsToFrames(0, 30), 0);
  assert.equal(secondsToFrames(1, 30), 30);
  assert.equal(secondsToFrames(2.5, 30), 75);
  assert.equal(secondsToFrames(0.35, 30), 11); // 10.5 -> 11
  assert.equal(secondsToFrames(1 / 3, 30), 10);
  assert.equal(secondsToFrames(0.0166, 30), 0);
  assert.equal(secondsToFrames(2.5, 60), 150);
});

test('beat offsets match the timeline exactly', () => {
  const tl = timeline(30, 24, [
    { beatId: 'a', startSeconds: 0, audioSeconds: 4, holdSeconds: 1.5 },
    { beatId: 'b', startSeconds: 5.5, audioSeconds: 6, holdSeconds: 1.2 },
    { beatId: 'c', startSeconds: 12.7, audioSeconds: 9.3, holdSeconds: 2 },
  ]);
  const plan = buildBeatPlan(tl);

  assert.equal(plan.leadInFrames, 0);
  for (const [index, clip] of plan.clips.entries()) {
    const beat = tl.beats[index]!;
    assert.equal(clip.beatId, beat.beatId);
    assert.equal(
      clip.fromFrame + plan.leadInFrames,
      secondsToFrames(beat.startSeconds, tl.fps),
      `beat ${beat.beatId} does not start where the timeline says`,
    );
  }
});

test('a lead-in is preserved and the clips still land on the timeline', () => {
  const tl = timeline(30, 20, [
    { beatId: 'a', startSeconds: 0.4, audioSeconds: 4, holdSeconds: 1.5 },
    { beatId: 'b', startSeconds: 6, audioSeconds: 12, holdSeconds: 2 },
  ]);
  const plan = buildBeatPlan(tl);

  assert.equal(plan.leadInFrames, secondsToFrames(0.4, 30));
  assert.equal(plan.clips[0]?.fromFrame, 0);
  assert.equal(
    plan.clips[1]!.fromFrame + plan.leadInFrames,
    secondsToFrames(6, 30),
  );
});

test('clips tile the body with no gap and no overlap', () => {
  const plan = buildBeatPlan(SAMPLE_PROPS.timeline);

  for (let i = 1; i < plan.clips.length; i++) {
    const previous = plan.clips[i - 1]!;
    assert.equal(
      previous.fromFrame + previous.spanFrames,
      plan.clips[i]!.fromFrame,
      'a gap or an overlap opened between two beats',
    );
  }
});

test('total body duration equals totalSeconds * fps', () => {
  for (const tl of [
    SAMPLE_PROPS.timeline,
    timeline(30, 24, [
      { beatId: 'a', startSeconds: 0, audioSeconds: 4, holdSeconds: 1.5 },
      { beatId: 'b', startSeconds: 5.5, audioSeconds: 17, holdSeconds: 1.5 },
    ]),
    timeline(60, 41.37, [
      { beatId: 'only', startSeconds: 0, audioSeconds: 39, holdSeconds: 2.37 },
    ]),
  ]) {
    const plan = buildBeatPlan(tl);
    const spanned = plan.clips.reduce((sum, clip) => sum + clip.spanFrames, 0);

    assert.equal(plan.bodyFrames, secondsToFrames(tl.totalSeconds, tl.fps));
    assert.equal(plan.leadInFrames + spanned, plan.bodyFrames);
  }
});

test('transitions are paid for with padding, never out of a beat', () => {
  const plan = buildBeatPlan(SAMPLE_PROPS.timeline);
  const last = plan.clips.length - 1;

  assert.ok(plan.transitionFrames > 0, 'the fixture should exercise transitions');
  for (const [index, clip] of plan.clips.entries()) {
    const padding = index < last ? plan.transitionFrames : 0;
    assert.equal(clip.seriesFrames, clip.spanFrames + padding);
  }

  // TransitionSeries length = sum(durations) - sum(transitions). The padding
  // has to cancel out exactly, or every beat after the first drifts.
  const seriesTotal = plan.clips.reduce((sum, clip) => sum + clip.seriesFrames, 0);
  const overlap = Math.max(0, plan.clips.length - 1) * plan.transitionFrames;
  const spanned = plan.clips.reduce((sum, clip) => sum + clip.spanFrames, 0);

  assert.equal(seriesTotal - overlap, spanned);
});

test('the full duration is title + body + end card, all derived from the timeline', () => {
  for (const tl of [
    SAMPLE_PROPS.timeline,
    timeline(24, 63.2, [{ beatId: 'a', startSeconds: 0, audioSeconds: 61, holdSeconds: 2.2 }]),
  ]) {
    const plan = buildFramePlan(tl);
    const title = secondsToFrames(TIMING.titleSeconds, tl.fps);
    const end = secondsToFrames(TIMING.endCardSeconds, tl.fps);

    assert.equal(plan.titleFrames, title);
    assert.equal(plan.endCardFrames, end);
    assert.equal(plan.bodyStartFrame, title);
    assert.equal(plan.bodyFrames, secondsToFrames(tl.totalSeconds, tl.fps));
    assert.equal(plan.endCardStartFrame, title + plan.bodyFrames);
    assert.equal(plan.totalFrames, title + plan.bodyFrames + end);
  }
});

test('an empty timeline still produces a renderable composition', () => {
  const plan = buildFramePlan(timeline(30, 0, []));

  assert.deepEqual(plan.clips, []);
  assert.equal(plan.leadInFrames, 0);
  assert.ok(plan.totalFrames >= 1);
});

test('out-of-order beats are sorted before they are laid out', () => {
  const tl = timeline(30, 15, [
    { beatId: 'second', startSeconds: 5, audioSeconds: 8, holdSeconds: 2 },
    { beatId: 'first', startSeconds: 0, audioSeconds: 4, holdSeconds: 1 },
  ]);
  const plan = buildBeatPlan(tl);

  assert.deepEqual(
    plan.clips.map((c) => c.beatId),
    ['first', 'second'],
  );
  assert.equal(plan.clips[0]?.fromFrame, 0);
});
