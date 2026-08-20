import { z } from 'zod';

/**
 * The authoritative timeline, produced by WhisperX after narration exists.
 * Manim and Remotion both read this; neither measures audio itself.
 */

export const Word = z.object({
  word: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  /** WhisperX alignment score, 0..1. Low scores mean the sync is a guess. */
  score: z.number().min(0).max(1).optional(),
});
export type Word = z.infer<typeof Word>;

export const BeatTimeline = z.object({
  beatId: z.string(),
  /** Offset of this beat's audio within the full narration track, in seconds. */
  startSeconds: z.number().min(0),
  /** Measured audio length. May differ from spec.durationSeconds for Kokoro drafts. */
  audioSeconds: z.number().min(0),
  /** Silence appended after the audio so the visual can breathe. */
  holdSeconds: z.number().min(0),
  /** Path to this beat's narration wav, relative to the render root. */
  audioPath: z.string(),
  words: z.array(Word),
  /**
   * Times (relative to the start of this beat) at which each emphasis phrase
   * from the spec is spoken. Archetypes reveal elements on these cues.
   */
  cues: z.array(z.object({ phrase: z.string(), atSeconds: z.number().min(0) })),
});
export type BeatTimeline = z.infer<typeof BeatTimeline>;

export const Timeline = z.object({
  /** Hash of the spec this timeline was built from. Guards against stale reuse. */
  specHash: z.string(),
  engine: z.enum(['kokoro', 'indextts2']),
  fps: z.number().int().positive(),
  totalSeconds: z.number().min(0),
  /** Path to the concatenated narration track, relative to the render root. */
  audioPath: z.string(),
  beats: z.array(BeatTimeline),
});
export type Timeline = z.infer<typeof Timeline>;

export function beatEndSeconds(beat: BeatTimeline): number {
  return beat.startSeconds + beat.audioSeconds + beat.holdSeconds;
}

/** Words that fall inside a window, used for lower-third caption chunks. */
export function wordsBetween(words: Word[], from: number, to: number): Word[] {
  return words.filter((w) => w.end > from && w.start < to);
}
