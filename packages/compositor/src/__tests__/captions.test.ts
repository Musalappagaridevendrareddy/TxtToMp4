import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeChunkIndex,
  activeWordIndex,
  buildCaptionTrack,
  chunkWords,
  toAbsoluteWords,
} from '../lib/captions';
import type { CaptionWord } from '../lib/props';
import { CAPTIONS } from '../theme';
import { SAMPLE_PROPS } from '../lib/fixture';

function words(count: number, perWord = 0.3, from = 0): CaptionWord[] {
  return Array.from({ length: count }, (_, i) => ({
    word: `w${i}`,
    start: Number((from + i * perWord).toFixed(6)),
    end: Number((from + (i + 1) * perWord - 0.02).toFixed(6)),
  }));
}

test('no chunk exceeds the word limit', () => {
  for (const input of [words(1), words(7), words(8), words(50), words(101, 0.05)]) {
    for (const chunk of chunkWords(input)) {
      assert.ok(
        chunk.words.length <= CAPTIONS.maxWords,
        `chunk of ${chunk.words.length} words exceeds ${CAPTIONS.maxWords}`,
      );
    }
  }
});

test('no chunk exceeds the time limit unless a single word does', () => {
  // 1.4s per word: two words already blow the 2.5s budget.
  for (const input of [words(20, 1.4), words(40, 0.5), words(60, 0.12)]) {
    for (const chunk of chunkWords(input)) {
      const span = chunk.endSeconds - chunk.startSeconds;
      assert.ok(
        span <= CAPTIONS.maxSeconds || chunk.words.length === 1,
        `chunk spans ${span}s with ${chunk.words.length} words`,
      );
    }
  }
});

test('a single word longer than the limit still gets a chunk', () => {
  const chunks = chunkWords([{ word: 'aaaaaaaa', start: 0, end: 9 }]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.words.length, 1);
  assert.equal(chunks[0]?.endSeconds, 9);
});

test('chunks cover every word exactly once, in order', () => {
  const input = words(97, 0.41);
  const flattened = chunkWords(input).flatMap((chunk) => chunk.words);

  assert.equal(flattened.length, input.length);
  assert.deepEqual(
    flattened.map((w) => w.word),
    input.map((w) => w.word),
  );
});

test('chunk bounds match their own words and never overlap', () => {
  const chunks = chunkWords(words(60, 0.44));
  let previousEnd = -Infinity;

  for (const chunk of chunks) {
    assert.equal(chunk.startSeconds, chunk.words[0]?.start);
    assert.equal(chunk.endSeconds, Math.max(...chunk.words.map((w) => w.end)));
    assert.ok(chunk.startSeconds >= previousEnd - 1e-9, 'chunks must not go backwards');
    previousEnd = chunk.endSeconds;
  }
});

test('empty input produces no chunks', () => {
  assert.deepEqual(chunkWords([]), []);
});

test('beat-relative word times are lifted onto the narration track', () => {
  const beat = {
    beatId: 'b',
    startSeconds: 12,
    audioSeconds: 3,
    holdSeconds: 1,
    words: words(4, 0.5, 0),
  };
  const absolute = toAbsoluteWords(beat);

  assert.equal(absolute[0]?.start, 12);
  assert.equal(absolute[3]?.start, 13.5);
});

test('already-absolute word times are left alone', () => {
  const beat = {
    beatId: 'b',
    startSeconds: 12,
    audioSeconds: 3,
    holdSeconds: 1,
    words: words(4, 0.5, 12),
  };
  const absolute = toAbsoluteWords(beat);

  assert.equal(absolute[0]?.start, 12);
  assert.equal(absolute[3]?.start, 13.5);
});

test('the caption track covers every word of the sample timeline', () => {
  const expected = SAMPLE_PROPS.timeline.beats.flatMap((beat) => beat.words.map((w) => w.word));
  const actual = buildCaptionTrack(SAMPLE_PROPS.timeline).flatMap((chunk) =>
    chunk.words.map((w) => w.word),
  );

  assert.deepEqual(actual, expected);
  assert.ok(actual.length > 0, 'the fixture must have words to caption');
});

test('the caption track is chronological across beat boundaries', () => {
  const chunks = buildCaptionTrack(SAMPLE_PROPS.timeline);
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i]!.startSeconds >= chunks[i - 1]!.startSeconds);
  }
});

test('activeChunkIndex holds the last chunk briefly, then drops it', () => {
  const chunks = chunkWords(words(6, 0.3));
  const chunk = chunks[0]!;

  assert.equal(activeChunkIndex(chunks, chunk.startSeconds - 0.1), -1);
  assert.equal(activeChunkIndex(chunks, chunk.startSeconds), 0);
  assert.equal(activeChunkIndex(chunks, chunk.endSeconds + 0.3), 0);
  assert.equal(activeChunkIndex(chunks, chunk.endSeconds + 5), -1);
});

test('activeWordIndex tracks the spoken word', () => {
  // Relaxed limits so all five words stay in one chunk for this assertion.
  const chunk = chunkWords(words(5, 1), 10, 60)[0]!;

  assert.equal(activeWordIndex(chunk, 0.1), 0);
  assert.equal(activeWordIndex(chunk, 2.5), 2);
  // Inside the gap between two words nothing is highlighted.
  assert.equal(activeWordIndex(chunk, 0.99), -1);
});
