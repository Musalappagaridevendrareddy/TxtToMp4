import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';

import { paletteFor } from './theme';
import { beatAssetPath, type ExplainerProps } from './lib/props';
import { buildFramePlan } from './lib/frames';
import { buildCaptionTrack } from './lib/captions';
import { TitleCard } from './components/TitleCard';
import { EndCard } from './components/EndCard';
import { BeatClip } from './components/BeatClip';
import { Captions } from './components/Captions';

/**
 * Title card -> narrated beats -> end card, with one narration track spanning
 * the beats and word-level captions in the reserved bottom band.
 *
 * Every frame number comes from `buildFramePlan`; there is not a single
 * literal duration in this file.
 */
export const Explainer: React.FC<ExplainerProps> = ({ spec, timeline, assets, kicker }) => {
  const palette = paletteFor(spec.palette);
  const plan = useMemo(() => buildFramePlan(timeline), [timeline]);
  const captions = useMemo(() => buildCaptionTrack(timeline), [timeline]);

  // TransitionSeries validates its children, so build a flat array rather than
  // wrapping the pairs in fragments.
  const series: React.ReactNode[] = [];
  plan.clips.forEach((clip, index) => {
    series.push(
      <TransitionSeries.Sequence key={`clip-${clip.beatId}`} durationInFrames={clip.seriesFrames}>
        <BeatClip assetPath={beatAssetPath(assets, clip.beatId)} />
      </TransitionSeries.Sequence>,
    );
    if (index < plan.clips.length - 1 && plan.transitionFrames > 0) {
      series.push(
        <TransitionSeries.Transition
          key={`transition-${clip.beatId}`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: plan.transitionFrames })}
        />,
      );
    }
  });

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <Sequence durationInFrames={plan.titleFrames} name="Title">
        <TitleCard
          topic={spec.topic}
          kicker={kicker}
          palette={palette}
          durationInFrames={plan.titleFrames}
        />
      </Sequence>

      <Sequence from={plan.bodyStartFrame} durationInFrames={plan.bodyFrames} name="Narration">
        {assets.audio.length > 0 ? <Audio src={staticFile(assets.audio)} /> : null}

        {series.length > 0 ? (
          <Sequence from={plan.leadInFrames} name="Beats">
            <TransitionSeries>{series}</TransitionSeries>
          </Sequence>
        ) : null}

        <Captions chunks={captions} palette={palette} />
      </Sequence>

      <Sequence
        from={plan.endCardStartFrame}
        durationInFrames={plan.endCardFrames}
        name="End card"
      >
        <EndCard
          topic={spec.topic}
          kicker={kicker}
          palette={palette}
          durationInFrames={plan.endCardFrames}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
