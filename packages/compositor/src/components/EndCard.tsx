import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, FONT_SIZE, FONT_WEIGHT, LAYOUT, TIMING, type Palette } from '../theme';

export interface EndCardProps {
  topic: string;
  kicker: string;
  palette: Palette;
  durationInFrames: number;
}

/**
 * The bookend: same three elements as the title card, centred and stilled.
 * Nothing moves except a single slow fade up -- the video is over, and the
 * frame should stop asking for attention.
 */
export const EndCard: React.FC<EndCardProps> = ({ topic, kicker, palette, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const settleFrames = Math.round(fps * 0.5);
  const fadeIn = interpolate(frame, [0, settleFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - TIMING.cardExitFrames, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: LAYOUT.safeMarginPx,
        textAlign: 'center',
        opacity: fadeIn * fadeOut,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: FONT.display,
          fontSize: FONT_SIZE.display,
          fontWeight: FONT_WEIGHT.display,
          lineHeight: LAYOUT.headlineLineHeight,
          letterSpacing: `${LAYOUT.headlineLetterSpacingEm}em`,
          color: palette.primary,
          maxWidth: `${LAYOUT.headlineMaxWidthRatio * 100}%`,
        }}
      >
        {topic}
      </h2>
      <div
        style={{
          width: LAYOUT.ruleWidthPx,
          height: LAYOUT.ruleThicknessPx,
          backgroundColor: palette.accent,
          margin: `${LAYOUT.safeMarginPx / 2}px 0`,
        }}
      />
      <div
        style={{
          fontFamily: FONT.body,
          fontSize: FONT_SIZE.body,
          fontWeight: FONT_WEIGHT.body,
          letterSpacing: `${LAYOUT.kickerLetterSpacingEm}em`,
          textTransform: 'uppercase',
          color: palette.muted,
        }}
      >
        {kicker}
      </div>
    </AbsoluteFill>
  );
};
