import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, FONT_SIZE, FONT_WEIGHT, LAYOUT, TIMING, type Palette } from '../theme';
import { activeChunkIndex, activeWordIndex, type CaptionChunk } from '../lib/captions';
import { framesToSeconds, secondsToFrames } from '../lib/frames';

export interface CaptionsProps {
  /** Pre-chunked track, in seconds from the start of the narration body. */
  chunks: CaptionChunk[];
  palette: Palette;
}

/** `#rrggbb` -> `rgba(...)`. The plate needs the palette background, softened. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const int = Number.parseInt(full.slice(0, 6), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Lower thirds, word-level. Anchored in the bottom `captionZoneRatio` band --
 * the same band the Manim layouts keep clear -- so captions can never sit on
 * top of the animation.
 */
export const Captions: React.FC<CaptionsProps> = ({ chunks, palette }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const seconds = framesToSeconds(frame, fps);

  const index = activeChunkIndex(chunks, seconds);
  if (index === -1) {
    return null;
  }
  const chunk = chunks[index]!;
  const spoken = activeWordIndex(chunk, seconds);

  const enteredFrames = frame - secondsToFrames(chunk.startSeconds, fps);
  const opacity = interpolate(enteredFrames, [0, TIMING.captionFadeFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: height * LAYOUT.captionZoneRatio,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: `${LAYOUT.captionMaxWidthRatio * 100}%`,
          padding: `${LAYOUT.captionPaddingYPx}px ${LAYOUT.captionPaddingXPx}px`,
          borderRadius: LAYOUT.captionRadiusPx,
          backgroundColor: withAlpha(palette.bg, 0.82),
          boxShadow: `0 0 0 1px ${withAlpha(palette.muted, 0.22)}`,
          fontFamily: FONT.body,
          fontSize: FONT_SIZE.body,
          fontWeight: FONT_WEIGHT.body,
          lineHeight: LAYOUT.captionLineHeight,
          textAlign: 'center',
          opacity,
        }}
      >
        {chunk.words.map((word, i) => (
          <span
            key={`${word.start}-${i}`}
            style={{
              color: i === spoken ? palette.accent : palette.primary,
              opacity: i === spoken ? 1 : 0.78,
              marginRight: '0.32em',
            }}
          >
            {word.word}
          </span>
        ))}
      </div>
    </div>
  );
};
