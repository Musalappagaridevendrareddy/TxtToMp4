import { z } from 'zod';

/**
 * The archetype library. These are the only animations that exist.
 * The model selects a name and fills typed params; it never writes code.
 *
 * Hard limit: at most MAX_ELEMENTS things are ever on screen at once.
 * Every params schema below is sized so a valid spec cannot exceed it.
 */
export const MAX_ELEMENTS = 5;

export const ARCHETYPE_NAMES = [
  'sequence',
  'branch',
  'containment',
  'transformation',
  'fan_out',
  'layered_build',
  'zoom_detail',
  'parallel_race',
  'accumulation',
  'cycle',
  'spatial_map',
  'reveal_conceal',
] as const;

export const ArchetypeName = z.enum(ARCHETYPE_NAMES);
export type ArchetypeName = z.infer<typeof ArchetypeName>;

/** A short piece of on-screen text. Long strings wreck layout, so they are capped hard. */
const Label = z.string().min(1).max(28);
/** Optional second line, one size down. */
const SubLabel = z.string().min(1).max(40);

const Node = z.object({
  label: Label,
  detail: SubLabel.optional(),
});

export const ArchetypeParams = {
  /** Steps following each other. Left-to-right, one at a time, arrows between. */
  sequence: z.object({
    steps: z.array(Node).min(2).max(4),
    arrowLabel: SubLabel.optional(),
  }),

  /** A decision that forks. One question node, two or three outcomes. */
  branch: z.object({
    question: Node,
    outcomes: z.array(Node).min(2).max(3),
  }),

  /** Things nested inside things. Outer box, then contents appear inside it. */
  containment: z.object({
    outer: Node,
    inner: z.array(Node).min(1).max(3),
    /** A second, deeper nesting level drawn inside the first inner item. */
    innermost: Node.optional(),
  }),

  /** A morphs into B. The single most useful archetype: Manim Transform. */
  transformation: z.object({
    before: Node,
    after: Node,
    /** Text shown on the arrow during the morph, e.g. "hash function". */
    via: SubLabel.optional(),
  }),

  /** One source, many destinations. Source on the left, targets fanned right. */
  fan_out: z.object({
    source: Node,
    targets: z.array(Node).min(2).max(4),
    /** Index into targets that should be highlighted after the fan completes. */
    highlightIndex: z.number().int().min(0).max(3).optional(),
  }),

  /** Concepts stacking up. Drawn bottom to top, one layer at a time. */
  layered_build: z.object({
    layers: z.array(Node).min(2).max(4),
    /** Label for the whole stack, shown to the side. */
    stackLabel: SubLabel.optional(),
  }),

  /** Overview, then magnify one part. */
  zoom_detail: z.object({
    overview: Node,
    /** Which part of the overview we zoom into. */
    focus: Node,
    /** What is revealed inside the focus once magnified. */
    revealed: z.array(Node).min(1).max(3),
  }),

  /** Two processes side by side, advancing in lockstep. */
  parallel_race: z.object({
    laneA: z.object({ label: Label, steps: z.array(Label).min(2).max(3) }),
    laneB: z.object({ label: Label, steps: z.array(Label).min(2).max(3) }),
    /** Optional note about what goes wrong / who wins, shown at the end. */
    verdict: SubLabel.optional(),
  }),

  /** Something filling, compounding, growing. */
  accumulation: z.object({
    /** What is accumulating, e.g. "balance". */
    subject: Node,
    /** Successive magnitudes, normalised 0..1, used directly as bar heights. */
    stages: z
      .array(z.object({ label: Label, magnitude: z.number().min(0).max(1) }))
      .min(2)
      .max(5),
  }),

  /** A loop with a return edge. */
  cycle: z.object({
    steps: z.array(Node).min(3).max(4),
    /** Text on the edge that closes the loop. */
    returnLabel: SubLabel.optional(),
  }),

  /** Position and distance carry meaning. Coordinates are normalised 0..1. */
  spatial_map: z.object({
    nodes: z
      .array(
        z.object({
          label: Label,
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
      )
      .min(2)
      .max(5),
    edges: z
      .array(
        z.object({
          from: z.number().int().min(0).max(4),
          to: z.number().int().min(0).max(4),
          label: SubLabel.optional(),
        }),
      )
      .max(4)
      .default([]),
  }),

  /** Hidden state becoming visible. A cover lifts off and contents appear. */
  reveal_conceal: z.object({
    cover: Node,
    hidden: z.array(Node).min(1).max(3),
    /** If true the animation runs backwards: visible things get concealed. */
    reverse: z.boolean().default(false),
  }),
} as const satisfies Record<ArchetypeName, z.ZodTypeAny>;

export type ArchetypeParamsMap = {
  [K in ArchetypeName]: z.infer<(typeof ArchetypeParams)[K]>;
};

/**
 * One-line descriptions, injected verbatim into the spec-emitter system
 * prompt. They are written for the model, not for us.
 */
export const ARCHETYPE_DESCRIPTIONS: Record<ArchetypeName, string> = {
  sequence: 'Steps that follow one another in order. Use when the concept IS its ordering.',
  branch: 'A decision point that forks into two or three outcomes.',
  containment: 'Things nested inside things. Use for scope, ownership, encapsulation.',
  transformation: 'A becomes B. Use when the insight is that one thing IS another in disguise.',
  fan_out: 'One source distributing to many destinations.',
  layered_build: 'Concepts stacking on top of each other, each resting on the one below.',
  zoom_detail: 'Show the whole, then magnify one part to reveal its internals.',
  parallel_race: 'Two processes running side by side, compared step for step.',
  accumulation: 'Something filling up, compounding, or growing over stages.',
  cycle: 'A loop that returns to its start.',
  spatial_map: 'Positions and distances on a plane carry the meaning.',
  reveal_conceal: 'Hidden state becoming visible (or visible state being hidden).',
};

/** Worked examples, one per archetype, injected into the system prompt. */
export const ARCHETYPE_EXAMPLES: Record<ArchetypeName, unknown> = {
  sequence: {
    steps: [
      { label: 'Send packet' },
      { label: 'Wait for ACK' },
      { label: 'Timeout' },
      { label: 'Resend' },
    ],
    arrowLabel: 'then',
  },
  branch: {
    question: { label: 'Slot occupied?' },
    outcomes: [{ label: 'Store here' }, { label: 'Probe next slot' }],
  },
  containment: {
    outer: { label: 'Process' },
    inner: [{ label: 'Thread A' }, { label: 'Thread B' }],
    innermost: { label: 'Stack' },
  },
  transformation: {
    before: { label: 'apple' },
    after: { label: 'index 4' },
    via: 'hash function',
  },
  fan_out: {
    source: { label: 'Origin server' },
    targets: [{ label: 'Edge: Tokyo' }, { label: 'Edge: Paris' }, { label: 'Edge: Iowa' }],
    highlightIndex: 1,
  },
  layered_build: {
    layers: [
      { label: 'Tokens' },
      { label: 'Parse tree' },
      { label: 'IR' },
      { label: 'Machine code' },
    ],
    stackLabel: 'compiler',
  },
  zoom_detail: {
    overview: { label: 'Hash map' },
    focus: { label: 'Bucket 4' },
    revealed: [{ label: 'apple -> 3' }, { label: 'grape -> 7' }],
  },
  parallel_race: {
    laneA: { label: 'Thread A', steps: ['read x = 0', 'write x = 1'] },
    laneB: { label: 'Thread B', steps: ['read x = 0', 'write x = 1'] },
    verdict: 'one increment is lost',
  },
  accumulation: {
    subject: { label: 'Balance' },
    stages: [
      { label: 'Year 1', magnitude: 0.1 },
      { label: 'Year 10', magnitude: 0.3 },
      { label: 'Year 20', magnitude: 0.62 },
      { label: 'Year 30', magnitude: 1 },
    ],
  },
  cycle: {
    steps: [{ label: 'Send' }, { label: 'Lost' }, { label: 'Timeout' }],
    returnLabel: 'retry',
  },
  spatial_map: {
    nodes: [
      { label: 'User', x: 0.1, y: 0.5 },
      { label: 'Edge', x: 0.45, y: 0.5 },
      { label: 'Origin', x: 0.9, y: 0.5 },
    ],
    edges: [
      { from: 0, to: 1, label: '10ms' },
      { from: 1, to: 2, label: '180ms' },
    ],
  },
  reveal_conceal: {
    cover: { label: 'Abstraction' },
    hidden: [{ label: 'Buffer' }, { label: 'Pointer' }],
    reverse: false,
  },
};
