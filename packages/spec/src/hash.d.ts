/**
 * Stable hash of a spec, used for render caching and to catch a timeline being
 * reused against a spec it was not built from. Key order must not matter, so
 * the value is serialised with sorted keys.
 */
export declare function specHash(spec: unknown): string;
