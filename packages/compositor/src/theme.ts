/**
 * The single source of visual truth for the compositor.
 *
 * ============================ KEEP IN SYNC ============================
 * These palettes MUST match `packages/manim-scenes/manim_scenes/theme.py`
 * exactly. The Manim beats are rendered with the Python palette and composited
 * on top of the background defined here; a drift of one hex value shows up as a
 * visible seam between the animation and the frame around it.
 *
 * `src/__tests__/theme.test.ts` reads the Python file and fails if the two
 * disagree. If you change a colour here, change it there in the same commit.
 *
 * The Python file exposes a module-level `PALETTES` mapping of dataclasses:
 *
 *     PALETTES: dict[str, Palette] = {
 *         "cool": Palette(
 *             name="cool", bg="#0A1220", primary="#4CC9F0",
 *             secondary="#4361EE", accent="#F5F9FF", muted="#5A6B85",
 *         ),
 *         ...
 *     }
 *
 * (the parity test also accepts plain dict-literal `"bg": "#0A1220"` style).
 *
 * Roles, quoting theme.py: `primary` carries structure, `secondary` supports
 * it, `accent` is the single loudest thing on screen -- spend it once per beat
 * -- and `muted` is for anything that has said its piece but has not left yet.
 * The compositor honours that: `accent` is spent on the rule and on the one
 * word currently being spoken, and on nothing else.
 * =====================================================================
 */

export const PALETTE_NAMES = ['cool', 'warm', 'neutral'] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

/** Four working colours plus the background. Nothing else is allowed on screen. */
export interface Palette {
  /** Canvas behind everything, including behind the transparent Manim WebM. */
  bg: string;
  /** Headline text and primary strokes. */
  primary: string;
  /** Supporting fills and secondary strokes. */
  secondary: string;
  /** The one colour used to draw the eye: rules, the spoken word, highlights. */
  accent: string;
  /** De-emphasised text: kickers, not-yet-spoken caption words. */
  muted: string;
}

/** The keys of `Palette`, in the order the parity test compares them. */
export const PALETTE_KEYS = ['bg', 'primary', 'secondary', 'accent', 'muted'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export const PALETTES: Record<PaletteName, Palette> = {
  cool: {
    bg: '#0A1220',
    primary: '#4CC9F0',
    secondary: '#4361EE',
    accent: '#F5F9FF',
    muted: '#5A6B85',
  },
  warm: {
    bg: '#14100C',
    primary: '#F5A524',
    secondary: '#E8654F',
    accent: '#FBF1DE',
    muted: '#7C6A56',
  },
  neutral: {
    bg: '#16181C',
    primary: '#EDEEF0',
    secondary: '#9AA0A6',
    accent: '#E0B04A',
    muted: '#575C63',
  },
};

export function paletteFor(name: PaletteName): Palette {
  return PALETTES[name];
}

/**
 * Canonical output format. `Root.tsx` reads this.
 * Mirrors PIXEL_WIDTH / PIXEL_HEIGHT / FPS in `manim_scenes/theme.py`.
 */
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

/**
 * Manim's scene-unit frame height, from `manim_scenes/theme.py` (FRAME_HEIGHT).
 * Used only to state the caption-zone contract in the units the Python side
 * thinks in.
 */
export const MANIM_FRAME_HEIGHT_UNITS = 8;

/**
 * Two font stacks, two sizes. The whole design is carried by weight, colour,
 * letter-spacing and space -- not by a size ramp.
 */
export const FONT = {
  /** Large display serif. Transitional/old-style, not a default Times fallback. */
  display:
    "'Iowan Old Style', 'Charter', 'Palatino Linotype', 'Book Antiqua', Palatino, 'Source Serif 4', Georgia, serif",
  /** Heavy grotesk for everything that is not the headline. */
  body: "'Inter', 'Inter Tight', 'Segoe UI Variable Display', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
} as const;

/** Exactly two sizes exist. Anything else is a bug. */
export const FONT_SIZE = {
  display: 112,
  body: 40,
} as const;

export const FONT_WEIGHT = {
  display: 500,
  body: 600,
} as const;

export const LAYOUT = {
  /** Nothing that matters is drawn outside this margin. */
  safeMarginPx: 128,
  /**
   * Bottom band reserved for captions. The Manim layout must leave it clear.
   *
   * CONTRACT MISMATCH, unresolved at time of writing: `manim_scenes/theme.py`
   * uses a uniform `MARGIN = 0.6` scene units, which clears only the bottom
   * 7.5% of the frame. 18% of Manim's 8.0-unit frame is 1.44 units, so the
   * Python side needs a bottom-specific margin of 1.44 (keeping 0.6 for the
   * top and sides) for the two to agree. Until it does, the caption plate is
   * opaque enough to occlude anything that strays into the band rather than
   * tangling with it -- see `Captions.tsx`.
   */
  captionZoneRatio: 0.18,
  /** Headline never runs the full width -- it reads as a column, not a banner. */
  headlineMaxWidthRatio: 0.72,
  /** Width the accent rule grows to during the title entrance. */
  ruleWidthPx: 280,
  ruleThicknessPx: 5,
  /** Caption plate. */
  captionMaxWidthRatio: 0.78,
  captionPaddingXPx: 44,
  captionPaddingYPx: 20,
  captionRadiusPx: 14,
  captionLineHeight: 1.25,
  /** Tracking used on the small uppercase kicker. */
  kickerLetterSpacingEm: 0.3,
  headlineLetterSpacingEm: -0.02,
  headlineLineHeight: 1.04,
} as const;

/**
 * The caption band expressed in Manim's scene units -- i.e. what
 * `manim_scenes/theme.py` needs for its *bottom* margin so nothing it draws
 * ends up underneath a caption. Currently 1.44; the Python side is at 0.6.
 */
export const MANIM_BOTTOM_MARGIN_UNITS = LAYOUT.captionZoneRatio * MANIM_FRAME_HEIGHT_UNITS;

export const TIMING = {
  /** Title card hold, in seconds. */
  titleSeconds: 2.5,
  /** End card hold, in seconds. */
  endCardSeconds: 2.5,
  /**
   * Cross-fade between beats. This is *added* to each clip as padding rather
   * than taken out of it, so a transition can never shorten a beat's hold.
   */
  transitionSeconds: 0.35,
  /** Frames a caption chunk takes to fade in. */
  captionFadeFrames: 4,
  /** Frames the title/end card content takes to fade out at its tail. */
  cardExitFrames: 10,
  /** Stagger between the rule, the kicker and the headline. */
  cardStaggerFrames: 5,
} as const;

/** Caption chunking limits. Shared by the runtime and the tests. */
export const CAPTIONS = {
  maxWords: 7,
  maxSeconds: 2.5,
} as const;
