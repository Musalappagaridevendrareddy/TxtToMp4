/**
 * Compile-time proof that the compositor's narrowed props (`src/lib/props.ts`)
 * still accept whatever `packages/spec` produces.
 *
 * These are type-only imports, so nothing here survives into the bundle -- but
 * `npm run typecheck` fails the moment the spec adds a required field the
 * compositor does not model, or renames one it does.
 */

import type { Palette as SpecPalette, VideoSpec } from '../../spec/src/schema';
import type { Timeline as SpecTimeline, Word as SpecWord } from '../../spec/src/timeline';
import type {
  CaptionWord,
  ExplainerSpecSummary,
  ExplainerTimeline,
  ExplainerProps,
} from './lib/props';

/** A real timeline must be usable as the composition's timeline prop. */
export const asExplainerTimeline = (timeline: SpecTimeline): ExplainerTimeline => timeline;

/** A real spec must be usable as the composition's spec summary. */
export const asExplainerSpec = (spec: VideoSpec): ExplainerSpecSummary => spec;

/** Word shape must match in both directions -- captions read these verbatim. */
export const asCaptionWord = (word: SpecWord): CaptionWord => word;
export const asSpecWord = (word: CaptionWord): SpecWord => word;

/** Palette names must be the same closed set, both ways. */
export const asSpecPalette = (palette: ExplainerSpecSummary['palette']): SpecPalette => palette;
export const asCompositorPalette = (palette: SpecPalette): ExplainerSpecSummary['palette'] =>
  palette;

/** Assembling props from the two real artefacts must type-check end to end. */
export const buildPropsFromContract = (
  spec: VideoSpec,
  timeline: SpecTimeline,
  assets: ExplainerProps['assets'],
  kicker: string,
): ExplainerProps => ({
  spec: { topic: spec.topic, palette: spec.palette },
  timeline,
  assets,
  kicker,
});
