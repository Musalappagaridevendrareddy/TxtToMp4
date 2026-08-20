import { z } from 'zod';
import { ArchetypeName, ArchetypeParams, type ArchetypeParamsMap } from './archetypes.js';

export const Arc = z.enum([
  'hook_tension_build_payoff',
  'compare_contrast',
  'walkthrough',
  'myth_correction',
]);
export type Arc = z.infer<typeof Arc>;

export const Palette = z.enum(['cool', 'warm', 'neutral']);
export type Palette = z.infer<typeof Palette>;

export const Pacing = z.enum(['brisk', 'deliberate']);
export type Pacing = z.infer<typeof Pacing>;

export const Emotion = z.enum(['neutral', 'curious', 'emphatic', 'calm']);
export type Emotion = z.infer<typeof Emotion>;

/**
 * One narrated animation unit. `params` is deliberately loose here and is
 * validated a second time against the per-archetype schema once the archetype
 * is known. Never trust it raw.
 */
export const Beat = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, 'beat id must be lowercase kebab/snake case'),
  narration: z.string().min(1).max(220),
  durationSeconds: z.number().min(1.5).max(12),
  archetype: ArchetypeName,
  params: z.record(z.unknown()),
  /**
   * Words or short phrases from `narration` that the animation should land on.
   * Matched against the WhisperX word timeline to sync reveals to speech.
   */
  emphasis: z.array(z.string().min(1).max(60)).max(6).default([]),
  emotion: Emotion.default('neutral'),
  holdAfterSeconds: z.number().min(0.8).max(3).default(1.5),
});
export type Beat = z.infer<typeof Beat>;

export const VideoSpec = z.object({
  topic: z.string().min(1).max(200),
  arc: Arc,
  palette: Palette,
  pacing: Pacing,
  totalDurationTarget: z.number().min(30).max(180),
  beats: z.array(Beat).min(3).max(14),
});
export type VideoSpec = z.infer<typeof VideoSpec>;

/** A beat whose params have been narrowed to its archetype's own shape. */
export type TypedBeat = {
  [K in keyof ArchetypeParamsMap]: Omit<Beat, 'archetype' | 'params'> & {
    archetype: K;
    params: ArchetypeParamsMap[K];
  };
}[keyof ArchetypeParamsMap];

export type TypedVideoSpec = Omit<VideoSpec, 'beats'> & { beats: TypedBeat[] };

export class SpecValidationError extends Error {
  constructor(
    message: string,
    /** Human-readable issues, one per line, safe to hand back to the model. */
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'SpecValidationError';
  }
}

function formatIssues(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${prefix}${path}: ${issue.message}`;
  });
}

/**
 * The only sanctioned way to turn untrusted JSON into a renderable spec.
 *
 * Two passes on purpose:
 *  1. the envelope (arc, palette, beats, durations)
 *  2. each beat's params against its own archetype schema
 *
 * Also enforces the invariants that no single-field schema can express.
 */
export function parseVideoSpec(input: unknown): TypedVideoSpec {
  const envelope = VideoSpec.safeParse(input);
  if (!envelope.success) {
    throw new SpecValidationError('VideoSpec envelope is invalid', formatIssues('', envelope.error));
  }

  const spec = envelope.data;
  const issues: string[] = [];
  const beats: TypedBeat[] = [];
  const seenIds = new Set<string>();

  for (const [index, beat] of spec.beats.entries()) {
    if (seenIds.has(beat.id)) {
      issues.push(`beats.${index}.id: duplicate beat id "${beat.id}"`);
    }
    seenIds.add(beat.id);

    const paramsSchema = ArchetypeParams[beat.archetype];
    const params = paramsSchema.safeParse(beat.params);
    if (!params.success) {
      issues.push(...formatIssues(`beats.${index} (${beat.archetype}) params.`, params.error));
      continue;
    }

    // Cross-field checks the per-field schemas cannot express.
    if (beat.archetype === 'fan_out') {
      const p = params.data as ArchetypeParamsMap['fan_out'];
      if (p.highlightIndex !== undefined && p.highlightIndex >= p.targets.length) {
        issues.push(
          `beats.${index} (fan_out) params.highlightIndex: ${p.highlightIndex} is out of range for ${p.targets.length} targets`,
        );
      }
    }
    if (beat.archetype === 'spatial_map') {
      const p = params.data as ArchetypeParamsMap['spatial_map'];
      for (const [edgeIndex, edge] of p.edges.entries()) {
        if (edge.from >= p.nodes.length || edge.to >= p.nodes.length) {
          issues.push(
            `beats.${index} (spatial_map) params.edges.${edgeIndex}: references a node index that does not exist`,
          );
        }
        if (edge.from === edge.to) {
          issues.push(
            `beats.${index} (spatial_map) params.edges.${edgeIndex}: an edge cannot start and end at the same node`,
          );
        }
      }
    }
    if (beat.archetype === 'accumulation') {
      const p = params.data as ArchetypeParamsMap['accumulation'];
      const monotonic = p.stages.every(
        (stage, i) => i === 0 || stage.magnitude >= p.stages[i - 1]!.magnitude,
      );
      if (!monotonic) {
        issues.push(
          `beats.${index} (accumulation) params.stages: magnitudes must not decrease — this archetype animates growth`,
        );
      }
    }

    beats.push({ ...beat, params: params.data } as TypedBeat);
  }

  // The narration has to fit in the beat, and the beats have to fit in the video.
  for (const [index, beat] of spec.beats.entries()) {
    const words = beat.narration.trim().split(/\s+/).length;
    const maxWords = Math.floor(beat.durationSeconds * 3.2); // ~190 wpm ceiling
    if (words > maxWords) {
      issues.push(
        `beats.${index}.narration: ${words} words will not fit in ${beat.durationSeconds}s (max ~${maxWords}). Shorten it or lengthen the beat.`,
      );
    }
    for (const phrase of beat.emphasis) {
      if (!beat.narration.toLowerCase().includes(phrase.toLowerCase())) {
        issues.push(
          `beats.${index}.emphasis: "${phrase}" does not appear in this beat's narration, so it can never be synced`,
        );
      }
    }
  }

  const total = spec.beats.reduce((sum, b) => sum + b.durationSeconds + b.holdAfterSeconds, 0);
  const drift = Math.abs(total - spec.totalDurationTarget);
  if (drift > spec.totalDurationTarget * 0.25) {
    issues.push(
      `beats: durations plus holds total ${total.toFixed(1)}s but totalDurationTarget is ${spec.totalDurationTarget}s — bring them within 25%`,
    );
  }

  if (issues.length > 0) {
    throw new SpecValidationError('VideoSpec beats are invalid', issues);
  }

  return { ...spec, beats };
}

/** Total runtime a spec will actually produce, holds included. */
export function specDuration(spec: Pick<VideoSpec, 'beats'>): number {
  return spec.beats.reduce((sum, b) => sum + b.durationSeconds + b.holdAfterSeconds, 0);
}
