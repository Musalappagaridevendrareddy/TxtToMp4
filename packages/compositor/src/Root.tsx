import React from 'react';
import { Composition } from 'remotion';

import { Explainer } from './Explainer';
import { VIDEO } from './theme';
import { ExplainerPropsSchema, type ExplainerProps } from './lib/props';
import { buildFramePlan } from './lib/frames';
import { SAMPLE_PROPS } from './lib/fixture';

export const COMPOSITION_ID = 'Explainer';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Explainer}
      schema={ExplainerPropsSchema}
      defaultProps={SAMPLE_PROPS}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      // Placeholder only: calculateMetadata below replaces it from the timeline
      // before a single frame is rendered. Remotion still requires the field.
      durationInFrames={1}
      calculateMetadata={({ props }: { props: ExplainerProps }) => {
        const plan = buildFramePlan(props.timeline);
        return {
          durationInFrames: plan.totalFrames,
          fps: props.timeline.fps,
          width: VIDEO.width,
          height: VIDEO.height,
          props,
        };
      }}
    />
  );
};
