import { TIMING } from '../theme';
import type { ExplainerTimeline } from './props';

/**
 * All frame arithmetic lives here, in one place, with no React and no DOM.
 * Nothing in the composition is allowed to multiply by an fps of its own.
 */

/** The one rounding rule. Half-up, matching Remotion's own frame indexing. */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

export interface BeatClipPlan {
  beatId: string;
  /** Start frame of the beat, relative to the start of the beat body. */
  fromFrame: number;
  /** Frames the beat genuinely owns: its audio plus its hold. */
  spanFrames: number;
  /**
   * Frames handed to `TransitionSeries.Sequence`. This is `spanFrames` plus the
   * transition length for every clip that has a successor: `TransitionSeries`
   * overlaps neighbours by the transition duration, so the padding -- and only
   * the padding -- is what the cross-fade consumes. The hold survives intact
   * and every `fromFrame` still lands exactly on the timeline.
   */
  seriesFrames: number;
}

export interface BeatPlan {
  /** Silence before the first beat, if the narration track has a lead-in. */
  leadInFrames: number;
  clips: BeatClipPlan[];
  /** Length of the narration body, i.e. `totalSeconds` in frames. */
  bodyFrames: number;
  transitionFrames: number;
}

export interface ExplainerFramePlan extends BeatPlan {
  fps: number;
  titleFrames: number;
  endCardFrames: number;
  /** Frame the beat body starts at within the finished video. */
  bodyStartFrame: number;
  /** Frame the end card starts at within the finished video. */
  endCardStartFrame: number;
  /** Title + body + end card. */
  totalFrames: number;
}

/**
 * Lay the beats out on the frame grid.
 *
 * A beat's span runs from its own `startSeconds` to the next beat's
 * `startSeconds` (and the last beat runs to `totalSeconds`). Deriving the span
 * from the neighbours rather than from `audioSeconds + holdSeconds` is what
 * guarantees the clips tile the body with no gaps and no overlap even when the
 * TTS engine's measured lengths do not add up perfectly.
 */
export function buildBeatPlan(
  timeline: ExplainerTimeline,
  transitionFrames: number = secondsToFrames(TIMING.transitionSeconds, timeline.fps),
): BeatPlan {
  const { fps } = timeline;
  const bodyFrames = secondsToFrames(timeline.totalSeconds, fps);

  const ordered = [...timeline.beats].sort((a, b) => a.startSeconds - b.startSeconds);
  if (ordered.length === 0) {
    return { leadInFrames: 0, clips: [], bodyFrames, transitionFrames };
  }

  const leadInFrames = Math.min(secondsToFrames(ordered[0]!.startSeconds, fps), bodyFrames);
  const lastIndex = ordered.length - 1;

  const clips: BeatClipPlan[] = ordered.map((beat, index) => {
    const next = ordered[index + 1];
    const startFrame = secondsToFrames(beat.startSeconds, fps) - leadInFrames;
    const endFrame =
      next === undefined
        ? bodyFrames - leadInFrames
        : secondsToFrames(next.startSeconds, fps) - leadInFrames;

    // A clip is never shorter than a frame, whatever the timeline claims.
    const spanFrames = Math.max(1, endFrame - startFrame);

    return {
      beatId: beat.beatId,
      fromFrame: startFrame,
      spanFrames,
      seriesFrames: spanFrames + (index < lastIndex ? transitionFrames : 0),
    };
  });

  return { leadInFrames, clips, bodyFrames, transitionFrames };
}

/** Frames the whole video occupies, derived from the timeline -- never fixed. */
export function buildFramePlan(timeline: ExplainerTimeline): ExplainerFramePlan {
  const { fps } = timeline;
  const plan = buildBeatPlan(timeline);
  const titleFrames = secondsToFrames(TIMING.titleSeconds, fps);
  const endCardFrames = secondsToFrames(TIMING.endCardSeconds, fps);

  return {
    ...plan,
    fps,
    titleFrames,
    endCardFrames,
    bodyStartFrame: titleFrames,
    endCardStartFrame: titleFrames + plan.bodyFrames,
    // Remotion refuses a zero-length composition, hence the floor.
    totalFrames: Math.max(1, titleFrames + plan.bodyFrames + endCardFrames),
  };
}
