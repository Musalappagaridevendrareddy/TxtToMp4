import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, FONT_SIZE, FONT_WEIGHT, LAYOUT, TIMING, type Palette } from '../theme';

export interface TitleCardProps {
  topic: string;
  kicker: string;
  palette: Palette;
  /** Frames this card is on screen, used to time the exit. */
  durationInFrames: number;
}

/**
 * Editorial title: a hairline accent rule that draws itself, a wide-tracked
 * uppercase kicker, then the topic set as a display serif column pinned to the
 * lower-left of the safe area. Bottom-left rather than dead-centre is the whole
 * point -- it reads as a book plate, not as a slide template.
 */
export const TitleCard: React.FC<TitleCardProps> = ({
  topic,
  kicker,
  palette,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const enter = (delayFrames: number): number =>
    spring({ frame: frame - delayFrames, fps, config: { damping: 200, mass: 0.6 } });

  const rule = enter(0);
  const kickerIn = enter(TIMING.cardStaggerFrames);
  const topicIn = enter(TIMING.cardStaggerFrames * 2);

  const exit = interpolate(
    frame,
    [durationInFrames - TIMING.cardExitFrames, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const lift = (progress: number, distancePx: number): string =>
    `translateY(${interpolate(progress, [0, 1], [distancePx, 0])}px)`;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.bg,
        justifyContent: 'flex-end',
        padding: LAYOUT.safeMarginPx,
        // Sit the block above the caption band so the two cards share a baseline.
        paddingBottom: height * LAYOUT.captionZoneRatio,
        opacity: exit,
      }}
    >
      <div
        style={{
          width: LAYOUT.ruleWidthPx * rule,
          height: LAYOUT.ruleThicknessPx,
          backgroundColor: palette.accent,
          marginBottom: LAYOUT.safeMarginPx / 3,
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
          opacity: kickerIn,
          transform: lift(kickerIn, 18),
          marginBottom: LAYOUT.safeMarginPx / 4,
        }}
      >
        {kicker}
      </div>
      <h1
        style={{
          margin: 0,
          fontFamily: FONT.display,
          fontSize: FONT_SIZE.display,
          fontWeight: FONT_WEIGHT.display,
          lineHeight: LAYOUT.headlineLineHeight,
          letterSpacing: `${LAYOUT.headlineLetterSpacingEm}em`,
          color: palette.primary,
          maxWidth: `${LAYOUT.headlineMaxWidthRatio * 100}%`,
          opacity: topicIn,
          transform: lift(topicIn, 30),
        }}
      >
        {topic}
      </h1>
    </AbsoluteFill>
  );
};
