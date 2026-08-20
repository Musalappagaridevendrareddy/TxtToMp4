import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';

export interface BeatClipProps {
  /**
   * Path of the beat's transparent WebM relative to the public directory, or
   * null when the media is not on disk (Studio opening on the sample fixture).
   */
  assetPath: string | null;
}

/**
 * One beat's Manim render. The WebM carries an alpha channel, so the palette
 * background painted by `Explainer` shows through -- there is deliberately no
 * background colour here.
 */
export const BeatClip: React.FC<BeatClipProps> = ({ assetPath }) => {
  if (assetPath === null) {
    return null;
  }

  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={staticFile(assetPath)}
        transparent
        // The beat's audio lives in the single narration track, not in the WebM.
        muted
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </AbsoluteFill>
  );
};
