import { CAPTIONS } from '../theme';
import type { CaptionWord, ExplainerBeatTimeline, ExplainerTimeline } from './props';

/**
 * Word-level caption logic. Pure, no React, no DOM -- this is the part that has
 * to be right, so it is the part that is tested.
 */

export interface CaptionChunk {
  /** Seconds from the start of the narration body. */
  startSeconds: number;
  endSeconds: number;
  words: CaptionWord[];
}

/**
 * WhisperX hands back word timestamps that may be absolute (offsets into the
 * full narration track) or beat-relative, depending on whether the beat was
 * aligned on its own wav or on the concatenated one. Both are legal in the
 * contract, so detect rather than assume: if the first word already sits inside
 * this beat's absolute window, the times are absolute.
 *
 * ponytail: a window test, not a flag. Add an explicit `wordsAreAbsolute` field
 * to the timeline schema if a producer ever emits something this cannot tell
 * apart (a beat starting at 0 is genuinely ambiguous -- and harmless, because
 * both readings give the same answer there).
 */
export function toAbsoluteWords(beat: ExplainerBeatTimeline): CaptionWord[] {
  const first = beat.words[0];
  if (first === undefined) {
    return [];
  }

  const beatEnd = beat.startSeconds + beat.audioSeconds + beat.holdSeconds;
  const tolerance = 0.25;
  const alreadyAbsolute =
    first.start >= beat.startSeconds - tolerance && first.start <= beatEnd + tolerance;

  if (alreadyAbsolute) {
    return beat.words.map((w) => ({ ...w }));
  }
  return beat.words.map((w) => ({
    ...w,
    start: w.start + beat.startSeconds,
    end: w.end + beat.startSeconds,
  }));
}

/**
 * Group words into readable chunks.
 *
 * Invariants (asserted in the tests):
 *  - no chunk holds more than `CAPTIONS.maxWords` words
 *  - no chunk spans more than `CAPTIONS.maxSeconds`, unless a single word does
 *    (a word cannot be split, so it gets a chunk of its own)
 *  - every input word appears in exactly one chunk, in the original order
 */
export function chunkWords(
  words: readonly CaptionWord[],
  maxWords: number = CAPTIONS.maxWords,
  maxSeconds: number = CAPTIONS.maxSeconds,
): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: CaptionWord[] = [];

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    const first = current[0]!;
    let end = first.end;
    for (const w of current) {
      end = Math.max(end, w.end);
    }
    chunks.push({ startSeconds: first.start, endSeconds: end, words: current });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const wouldOverflowCount = current.length >= maxWords;
      const wouldOverflowTime = word.end - current[0]!.start > maxSeconds;
      if (wouldOverflowCount || wouldOverflowTime) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return chunks;
}

/** Every caption chunk of the whole video, in narration-body seconds. */
export function buildCaptionTrack(timeline: ExplainerTimeline): CaptionChunk[] {
  return [...timeline.beats]
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .flatMap((beat) => chunkWords(toAbsoluteWords(beat)));
}

/**
 * The chunk to display at time `t`. Between chunks the previous one is held
 * rather than blanked -- captions that flicker off in every gap between words
 * are unreadable. It is dropped once the next chunk starts, or after
 * `holdSeconds` of silence.
 */
export function activeChunkIndex(
  chunks: readonly CaptionChunk[],
  seconds: number,
  holdSeconds = 0.6,
): number {
  let candidate = -1;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (chunk.startSeconds > seconds) {
      break;
    }
    candidate = i;
  }
  if (candidate === -1) {
    return -1;
  }
  const chunk = chunks[candidate]!;
  if (seconds > chunk.endSeconds + holdSeconds) {
    return -1;
  }
  return candidate;
}

/** Index of the word being spoken inside a chunk, or -1 between words. */
export function activeWordIndex(chunk: CaptionChunk, seconds: number): number {
  for (let i = 0; i < chunk.words.length; i++) {
    const word = chunk.words[i]!;
    if (seconds >= word.start && seconds < word.end) {
      return i;
    }
  }
  return -1;
}
