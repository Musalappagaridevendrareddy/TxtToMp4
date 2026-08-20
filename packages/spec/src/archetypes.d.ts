import { z } from 'zod';
/**
 * The archetype library. These are the only animations that exist.
 * The model selects a name and fills typed params; it never writes code.
 *
 * Hard limit: at most MAX_ELEMENTS things are ever on screen at once.
 * Every params schema below is sized so a valid spec cannot exceed it.
 */
export declare const MAX_ELEMENTS = 5;
export declare const ARCHETYPE_NAMES: readonly ["sequence", "branch", "containment", "transformation", "fan_out", "layered_build", "zoom_detail", "parallel_race", "accumulation", "cycle", "spatial_map", "reveal_conceal"];
export declare const ArchetypeName: z.ZodEnum<["sequence", "branch", "containment", "transformation", "fan_out", "layered_build", "zoom_detail", "parallel_race", "accumulation", "cycle", "spatial_map", "reveal_conceal"]>;
export type ArchetypeName = z.infer<typeof ArchetypeName>;
export declare const ArchetypeParams: {
    /** Steps following each other. Left-to-right, one at a time, arrows between. */
    readonly sequence: z.ZodObject<{
        steps: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
        arrowLabel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        steps: {
            label: string;
            detail?: string | undefined;
        }[];
        arrowLabel?: string | undefined;
    }, {
        steps: {
            label: string;
            detail?: string | undefined;
        }[];
        arrowLabel?: string | undefined;
    }>;
    /** A decision that forks. One question node, two or three outcomes. */
    readonly branch: z.ZodObject<{
        question: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        outcomes: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        question: {
            label: string;
            detail?: string | undefined;
        };
        outcomes: {
            label: string;
            detail?: string | undefined;
        }[];
    }, {
        question: {
            label: string;
            detail?: string | undefined;
        };
        outcomes: {
            label: string;
            detail?: string | undefined;
        }[];
    }>;
    /** Things nested inside things. Outer box, then contents appear inside it. */
    readonly containment: z.ZodObject<{
        outer: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        inner: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
        /** A second, deeper nesting level drawn inside the first inner item. */
        innermost: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        outer: {
            label: string;
            detail?: string | undefined;
        };
        inner: {
            label: string;
            detail?: string | undefined;
        }[];
        innermost?: {
            label: string;
            detail?: string | undefined;
        } | undefined;
    }, {
        outer: {
            label: string;
            detail?: string | undefined;
        };
        inner: {
            label: string;
            detail?: string | undefined;
        }[];
        innermost?: {
            label: string;
            detail?: string | undefined;
        } | undefined;
    }>;
    /** A morphs into B. The single most useful archetype: Manim Transform. */
    readonly transformation: z.ZodObject<{
        before: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        after: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        /** Text shown on the arrow during the morph, e.g. "hash function". */
        via: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        before: {
            label: string;
            detail?: string | undefined;
        };
        after: {
            label: string;
            detail?: string | undefined;
        };
        via?: string | undefined;
    }, {
        before: {
            label: string;
            detail?: string | undefined;
        };
        after: {
            label: string;
            detail?: string | undefined;
        };
        via?: string | undefined;
    }>;
    /** One source, many destinations. Source on the left, targets fanned right. */
    readonly fan_out: z.ZodObject<{
        source: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        targets: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
        /** Index into targets that should be highlighted after the fan completes. */
        highlightIndex: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        source: {
            label: string;
            detail?: string | undefined;
        };
        targets: {
            label: string;
            detail?: string | undefined;
        }[];
        highlightIndex?: number | undefined;
    }, {
        source: {
            label: string;
            detail?: string | undefined;
        };
        targets: {
            label: string;
            detail?: string | undefined;
        }[];
        highlightIndex?: number | undefined;
    }>;
    /** Concepts stacking up. Drawn bottom to top, one layer at a time. */
    readonly layered_build: z.ZodObject<{
        layers: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
        /** Label for the whole stack, shown to the side. */
        stackLabel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        layers: {
            label: string;
            detail?: string | undefined;
        }[];
        stackLabel?: string | undefined;
    }, {
        layers: {
            label: string;
            detail?: string | undefined;
        }[];
        stackLabel?: string | undefined;
    }>;
    /** Overview, then magnify one part. */
    readonly zoom_detail: z.ZodObject<{
        overview: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        /** Which part of the overview we zoom into. */
        focus: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        /** What is revealed inside the focus once magnified. */
        revealed: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        overview: {
            label: string;
            detail?: string | undefined;
        };
        focus: {
            label: string;
            detail?: string | undefined;
        };
        revealed: {
            label: string;
            detail?: string | undefined;
        }[];
    }, {
        overview: {
            label: string;
            detail?: string | undefined;
        };
        focus: {
            label: string;
            detail?: string | undefined;
        };
        revealed: {
            label: string;
            detail?: string | undefined;
        }[];
    }>;
    /** Two processes side by side, advancing in lockstep. */
    readonly parallel_race: z.ZodObject<{
        laneA: z.ZodObject<{
            label: z.ZodString;
            steps: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            label: string;
            steps: string[];
        }, {
            label: string;
            steps: string[];
        }>;
        laneB: z.ZodObject<{
            label: z.ZodString;
            steps: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            label: string;
            steps: string[];
        }, {
            label: string;
            steps: string[];
        }>;
        /** Optional note about what goes wrong / who wins, shown at the end. */
        verdict: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        laneA: {
            label: string;
            steps: string[];
        };
        laneB: {
            label: string;
            steps: string[];
        };
        verdict?: string | undefined;
    }, {
        laneA: {
            label: string;
            steps: string[];
        };
        laneB: {
            label: string;
            steps: string[];
        };
        verdict?: string | undefined;
    }>;
    /** Something filling, compounding, growing. */
    readonly accumulation: z.ZodObject<{
        /** What is accumulating, e.g. "balance". */
        subject: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        /** Successive magnitudes, normalised 0..1, used directly as bar heights. */
        stages: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            magnitude: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            label: string;
            magnitude: number;
        }, {
            label: string;
            magnitude: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        subject: {
            label: string;
            detail?: string | undefined;
        };
        stages: {
            label: string;
            magnitude: number;
        }[];
    }, {
        subject: {
            label: string;
            detail?: string | undefined;
        };
        stages: {
            label: string;
            magnitude: number;
        }[];
    }>;
    /** A loop with a return edge. */
    readonly cycle: z.ZodObject<{
        steps: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
        /** Text on the edge that closes the loop. */
        returnLabel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        steps: {
            label: string;
            detail?: string | undefined;
        }[];
        returnLabel?: string | undefined;
    }, {
        steps: {
            label: string;
            detail?: string | undefined;
        }[];
        returnLabel?: string | undefined;
    }>;
    /** Position and distance carry meaning. Coordinates are normalised 0..1. */
    readonly spatial_map: z.ZodObject<{
        nodes: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            label: string;
            x: number;
            y: number;
        }, {
            label: string;
            x: number;
            y: number;
        }>, "many">;
        edges: z.ZodDefault<z.ZodArray<z.ZodObject<{
            from: z.ZodNumber;
            to: z.ZodNumber;
            label: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            from: number;
            to: number;
            label?: string | undefined;
        }, {
            from: number;
            to: number;
            label?: string | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        nodes: {
            label: string;
            x: number;
            y: number;
        }[];
        edges: {
            from: number;
            to: number;
            label?: string | undefined;
        }[];
    }, {
        nodes: {
            label: string;
            x: number;
            y: number;
        }[];
        edges?: {
            from: number;
            to: number;
            label?: string | undefined;
        }[] | undefined;
    }>;
    /** Hidden state becoming visible. A cover lifts off and contents appear. */
    readonly reveal_conceal: z.ZodObject<{
        cover: z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>;
        hidden: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            detail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            detail?: string | undefined;
        }, {
            label: string;
            detail?: string | undefined;
        }>, "many">;
        /** If true the animation runs backwards: visible things get concealed. */
        reverse: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        reverse: boolean;
        cover: {
            label: string;
            detail?: string | undefined;
        };
        hidden: {
            label: string;
            detail?: string | undefined;
        }[];
    }, {
        cover: {
            label: string;
            detail?: string | undefined;
        };
        hidden: {
            label: string;
            detail?: string | undefined;
        }[];
        reverse?: boolean | undefined;
    }>;
};
export type ArchetypeParamsMap = {
    [K in ArchetypeName]: z.infer<(typeof ArchetypeParams)[K]>;
};
/**
 * One-line descriptions, injected verbatim into the spec-emitter system
 * prompt. They are written for the model, not for us.
 */
export declare const ARCHETYPE_DESCRIPTIONS: Record<ArchetypeName, string>;
/** Worked examples, one per archetype, injected into the system prompt. */
export declare const ARCHETYPE_EXAMPLES: Record<ArchetypeName, unknown>;
