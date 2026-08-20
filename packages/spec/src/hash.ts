import { createHash } from 'node:crypto';

/**
 * Stable hash of a spec, used for render caching and to catch a timeline being
 * reused against a spec it was not built from. Key order must not matter, so
 * the value is serialised with sorted keys.
 */
export function specHash(spec: unknown): string {
  return createHash('sha256').update(stableStringify(spec)).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
