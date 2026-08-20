import { z } from 'zod';
/**
 * The authoritative timeline, produced by WhisperX after narration exists.
 * Manim and Remotion both read this; neither measures audio itself.
 */
export declare const Word: z.ZodObject<{
    word: z.ZodString;
    start: z.ZodNumber;
    end: z.ZodNumber;
    /** WhisperX alignment score, 0..1. Low scores mean the sync is a guess. */
    score: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    word: string;
    start: number;
    end: number;
    score?: number | undefined;
}, {
    word: string;
    start: number;
    end: number;
    score?: number | undefined;
}>;
export type Word = z.infer<typeof Word>;
export declare const BeatTimeline: z.ZodObject<{
    beatId: z.ZodString;
    /** Offset of this beat's audio within the full narration track, in seconds. */
    startSeconds: z.ZodNumber;
    /** Measured audio length. May differ from spec.durationSeconds for Kokoro drafts. */
    audioSeconds: z.ZodNumber;
    /** Silence appended after the audio so the visual can breathe. */
    holdSeconds: z.ZodNumber;
    /** Path to this beat's narration wav, relative to the render root. */
    audioPath: z.ZodString;
    words: z.ZodArray<z.ZodObject<{
        word: z.ZodString;
        start: z.ZodNumber;
        end: z.ZodNumber;
        /** WhisperX alignment score, 0..1. Low scores mean the sync is a guess. */
        score: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        word: string;
        start: number;
        end: number;
        score?: number | undefined;
    }, {
        word: string;
        start: number;
        end: number;
        score?: number | undefined;
    }>, "many">;
    /**
     * Times (relative to the start of this beat) at which each emphasis phrase
     * from the spec is spoken. Archetypes reveal elements on these cues.
     */
    cues: z.ZodArray<z.ZodObject<{
        phrase: z.ZodString;
        atSeconds: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        phrase: string;
        atSeconds: number;
    }, {
        phrase: string;
        atSeconds: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    beatId: string;
    startSeconds: number;
    audioSeconds: number;
    holdSeconds: number;
    audioPath: string;
    words: {
        word: string;
        start: number;
        end: number;
        score?: number | undefined;
    }[];
    cues: {
        phrase: string;
        atSeconds: number;
    }[];
}, {
    beatId: string;
    startSeconds: number;
    audioSeconds: number;
    holdSeconds: number;
    audioPath: string;
    words: {
        word: string;
        start: number;
        end: number;
        score?: number | undefined;
    }[];
    cues: {
        phrase: string;
        atSeconds: number;
    }[];
}>;
export type BeatTimeline = z.infer<typeof BeatTimeline>;
export declare const Timeline: z.ZodObject<{
    /** Hash of the spec this timeline was built from. Guards against stale reuse. */
    specHash: z.ZodString;
    engine: z.ZodEnum<["kokoro", "indextts2"]>;
    fps: z.ZodNumber;
    totalSeconds: z.ZodNumber;
    /** Path to the concatenated narration track, relative to the render root. */
    audioPath: z.ZodString;
    beats: z.ZodArray<z.ZodObject<{
        beatId: z.ZodString;
        /** Offset of this beat's audio within the full narration track, in seconds. */
        startSeconds: z.ZodNumber;
        /** Measured audio length. May differ from spec.durationSeconds for Kokoro drafts. */
        audioSeconds: z.ZodNumber;
        /** Silence appended after the audio so the visual can breathe. */
        holdSeconds: z.ZodNumber;
        /** Path to this beat's narration wav, relative to the render root. */
        audioPath: z.ZodString;
        words: z.ZodArray<z.ZodObject<{
            word: z.ZodString;
            start: z.ZodNumber;
            end: z.ZodNumber;
            /** WhisperX alignment score, 0..1. Low scores mean the sync is a guess. */
            score: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            word: string;
            start: number;
            end: number;
            score?: number | undefined;
        }, {
            word: string;
            start: number;
            end: number;
            score?: number | undefined;
        }>, "many">;
        /**
         * Times (relative to the start of this beat) at which each emphasis phrase
         * from the spec is spoken. Archetypes reveal elements on these cues.
         */
        cues: z.ZodArray<z.ZodObject<{
            phrase: z.ZodString;
            atSeconds: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            phrase: string;
            atSeconds: number;
        }, {
            phrase: string;
            atSeconds: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        beatId: string;
        startSeconds: number;
        audioSeconds: number;
        holdSeconds: number;
        audioPath: string;
        words: {
            word: string;
            start: number;
            end: number;
            score?: number | undefined;
        }[];
        cues: {
            phrase: string;
            atSeconds: number;
        }[];
    }, {
        beatId: string;
        startSeconds: number;
        audioSeconds: number;
        holdSeconds: number;
        audioPath: string;
        words: {
            word: string;
            start: number;
            end: number;
            score?: number | undefined;
        }[];
        cues: {
            phrase: string;
            atSeconds: number;
        }[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    beats: {
        beatId: string;
        startSeconds: number;
        audioSeconds: number;
        holdSeconds: number;
        audioPath: string;
        words: {
            word: string;
            start: number;
            end: number;
            score?: number | undefined;
        }[];
        cues: {
            phrase: string;
            atSeconds: number;
        }[];
    }[];
    audioPath: string;
    specHash: string;
    engine: "kokoro" | "indextts2";
    fps: number;
    totalSeconds: number;
}, {
    beats: {
        beatId: string;
        startSeconds: number;
        audioSeconds: number;
        holdSeconds: number;
        audioPath: string;
        words: {
            word: string;
            start: number;
            end: number;
            score?: number | undefined;
        }[];
        cues: {
            phrase: string;
            atSeconds: number;
        }[];
    }[];
    audioPath: string;
    specHash: string;
    engine: "kokoro" | "indextts2";
    fps: number;
    totalSeconds: number;
}>;
export type Timeline = z.infer<typeof Timeline>;
export declare function beatEndSeconds(beat: BeatTimeline): number;
/** Words that fall inside a window, used for lower-third caption chunks. */
export declare function wordsBetween(words: Word[], from: number, to: number): Word[];
