import { z } from 'zod';
import { PALETTE_NAMES } from '../theme';

/**
 * The compositor's view of the contract.
 *
 * This is a deliberate *narrowing* of `packages/spec` rather than a re-export:
 * at composite time the archetype params are already baked into the WebMs, so
 * the compositor only needs the topic, the palette and the timing. Keeping the
 * mirror small means the Remotion bundle does not pull the whole archetype
 * library into the browser.
 *
 * `src/contract-parity.ts` holds compile-time assertions that the real
 * `VideoSpec` / `Timeline` types are assignable to these, so the narrowing can
 * never silently drift from the source of truth.
 */

export const PaletteNameSchema = z.enum(PALETTE_NAMES);

export const WordSchema = z.object({
  word: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  score: z.number().min(0).max(1).optional(),
});
export type CaptionWord = z.infer<typeof WordSchema>;

export const BeatTimelineSchema = z.object({
  beatId: z.string().min(1),
  /** Offset of this beat within the narration track, in seconds. */
  startSeconds: z.number().min(0),
  audioSeconds: z.number().min(0),
  holdSeconds: z.number().min(0),
  words: z.array(WordSchema),
});
export type ExplainerBeatTimeline = z.infer<typeof BeatTimelineSchema>;

export const TimelineSchema = z.object({
  fps: z.number().int().positive(),
  totalSeconds: z.number().min(0),
  beats: z.array(BeatTimelineSchema),
});
export type ExplainerTimeline = z.infer<typeof TimelineSchema>;

export const SpecSummarySchema = z.object({
  topic: z.string().min(1),
  palette: PaletteNameSchema,
});
export type ExplainerSpecSummary = z.infer<typeof SpecSummarySchema>;

/**
 * Asset locations, relative to the Remotion public directory (the render root).
 * They are resolved with `staticFile()` in the components so the same props
 * work in Studio and in a headless render.
 *
 * An empty string means "not available" and the corresponding element is simply
 * not rendered -- that is what lets Studio open on the sample fixture without
 * any media on disk.
 */
export const AssetsSchema = z.object({
  /** Directory holding `<beatId>.webm`, e.g. `beats`. */
  beatsDir: z.string(),
  /** Narration track, e.g. `narration.wav`. */
  audio: z.string(),
});
export type ExplainerAssets = z.infer<typeof AssetsSchema>;

export const ExplainerPropsSchema = z.object({
  spec: SpecSummarySchema,
  timeline: TimelineSchema,
  assets: AssetsSchema,
  /** Small uppercase label that bookends the title and end cards. */
  kicker: z.string(),
});
export type ExplainerProps = z.infer<typeof ExplainerPropsSchema>;

/** Relative path of a beat's transparent WebM, or null when unavailable. */
export function beatAssetPath(assets: ExplainerAssets, beatId: string): string | null {
  if (assets.beatsDir.length === 0) {
    return null;
  }
  return `${assets.beatsDir.replace(/\/+$/, '')}/${beatId}.webm`;
}
