import { z } from 'zod';
import { type ArchetypeParamsMap } from './archetypes.js';
export declare const Arc: z.ZodEnum<["hook_tension_build_payoff", "compare_contrast", "walkthrough", "myth_correction"]>;
export type Arc = z.infer<typeof Arc>;
export declare const Palette: z.ZodEnum<["cool", "warm", "neutral"]>;
export type Palette = z.infer<typeof Palette>;
export declare const Pacing: z.ZodEnum<["brisk", "deliberate"]>;
export type Pacing = z.infer<typeof Pacing>;
export declare const Emotion: z.ZodEnum<["neutral", "curious", "emphatic", "calm"]>;
export type Emotion = z.infer<typeof Emotion>;
/**
 * One narrated animation unit. `params` is deliberately loose here and is
 * validated a second time against the per-archetype schema once the archetype
 * is known. Never trust it raw.
 */
export declare const Beat: z.ZodObject<{
    id: z.ZodString;
    narration: z.ZodString;
    durationSeconds: z.ZodNumber;
    archetype: z.ZodEnum<["sequence", "branch", "containment", "transformation", "fan_out", "layered_build", "zoom_detail", "parallel_race", "accumulation", "cycle", "spatial_map", "reveal_conceal"]>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    /**
     * Words or short phrases from `narration` that the animation should land on.
     * Matched against the WhisperX word timeline to sync reveals to speech.
     */
    emphasis: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    emotion: z.ZodDefault<z.ZodEnum<["neutral", "curious", "emphatic", "calm"]>>;
    holdAfterSeconds: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    params: Record<string, unknown>;
    narration: string;
    durationSeconds: number;
    archetype: "sequence" | "branch" | "containment" | "transformation" | "fan_out" | "layered_build" | "zoom_detail" | "parallel_race" | "accumulation" | "cycle" | "spatial_map" | "reveal_conceal";
    emphasis: string[];
    emotion: "neutral" | "curious" | "emphatic" | "calm";
    holdAfterSeconds: number;
}, {
    id: string;
    params: Record<string, unknown>;
    narration: string;
    durationSeconds: number;
    archetype: "sequence" | "branch" | "containment" | "transformation" | "fan_out" | "layered_build" | "zoom_detail" | "parallel_race" | "accumulation" | "cycle" | "spatial_map" | "reveal_conceal";
    emphasis?: string[] | undefined;
    emotion?: "neutral" | "curious" | "emphatic" | "calm" | undefined;
    holdAfterSeconds?: number | undefined;
}>;
export type Beat = z.infer<typeof Beat>;
export declare const VideoSpec: z.ZodObject<{
    topic: z.ZodString;
    arc: z.ZodEnum<["hook_tension_build_payoff", "compare_contrast", "walkthrough", "myth_correction"]>;
    palette: z.ZodEnum<["cool", "warm", "neutral"]>;
    pacing: z.ZodEnum<["brisk", "deliberate"]>;
    totalDurationTarget: z.ZodNumber;
    beats: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        narration: z.ZodString;
        durationSeconds: z.ZodNumber;
        archetype: z.ZodEnum<["sequence", "branch", "containment", "transformation", "fan_out", "layered_build", "zoom_detail", "parallel_race", "accumulation", "cycle", "spatial_map", "reveal_conceal"]>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        /**
         * Words or short phrases from `narration` that the animation should land on.
         * Matched against the WhisperX word timeline to sync reveals to speech.
         */
        emphasis: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        emotion: z.ZodDefault<z.ZodEnum<["neutral", "curious", "emphatic", "calm"]>>;
        holdAfterSeconds: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        params: Record<string, unknown>;
        narration: string;
        durationSeconds: number;
        archetype: "sequence" | "branch" | "containment" | "transformation" | "fan_out" | "layered_build" | "zoom_detail" | "parallel_race" | "accumulation" | "cycle" | "spatial_map" | "reveal_conceal";
        emphasis: string[];
        emotion: "neutral" | "curious" | "emphatic" | "calm";
        holdAfterSeconds: number;
    }, {
        id: string;
        params: Record<string, unknown>;
        narration: string;
        durationSeconds: number;
        archetype: "sequence" | "branch" | "containment" | "transformation" | "fan_out" | "layered_build" | "zoom_detail" | "parallel_race" | "accumulation" | "cycle" | "spatial_map" | "reveal_conceal";
        emphasis?: string[] | undefined;
        emotion?: "neutral" | "curious" | "emphatic" | "calm" | undefined;
        holdAfterSeconds?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    topic: string;
    arc: "hook_tension_build_payoff" | "compare_contrast" | "walkthrough" | "myth_correction";
    palette: "cool" | "warm" | "neutral";
    pacing: "brisk" | "deliberate";
    totalDurationTarget: number;
    beats: {
        id: string;
        params: Record<string, unknown>;
        narration: string;
        durationSeconds: number;
        archetype: "sequence" | "branch" | "containment" | "transformation" | "fan_out" | "layered_build" | "zoom_detail" | "parallel_race" | "accumulation" | "cycle" | "spatial_map" | "reveal_conceal";
        emphasis: string[];
        emotion: "neutral" | "curious" | "emphatic" | "calm";
        holdAfterSeconds: number;
    }[];
}, {
    topic: string;
    arc: "hook_tension_build_payoff" | "compare_contrast" | "walkthrough" | "myth_correction";
    palette: "cool" | "warm" | "neutral";
    pacing: "brisk" | "deliberate";
    totalDurationTarget: number;
    beats: {
        id: string;
        params: Record<string, unknown>;
        narration: string;
        durationSeconds: number;
        archetype: "sequence" | "branch" | "containment" | "transformation" | "fan_out" | "layered_build" | "zoom_detail" | "parallel_race" | "accumulation" | "cycle" | "spatial_map" | "reveal_conceal";
        emphasis?: string[] | undefined;
        emotion?: "neutral" | "curious" | "emphatic" | "calm" | undefined;
        holdAfterSeconds?: number | undefined;
    }[];
}>;
export type VideoSpec = z.infer<typeof VideoSpec>;
/** A beat whose params have been narrowed to its archetype's own shape. */
export type TypedBeat = {
    [K in keyof ArchetypeParamsMap]: Omit<Beat, 'archetype' | 'params'> & {
        archetype: K;
        params: ArchetypeParamsMap[K];
    };
}[keyof ArchetypeParamsMap];
export type TypedVideoSpec = Omit<VideoSpec, 'beats'> & {
    beats: TypedBeat[];
};
export declare class SpecValidationError extends Error {
    /** Human-readable issues, one per line, safe to hand back to the model. */
    readonly issues: string[];
    constructor(message: string, 
    /** Human-readable issues, one per line, safe to hand back to the model. */
    issues: string[]);
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
export declare function parseVideoSpec(input: unknown): TypedVideoSpec;
/** Total runtime a spec will actually produce, holds included. */
export declare function specDuration(spec: Pick<VideoSpec, 'beats'>): number;
