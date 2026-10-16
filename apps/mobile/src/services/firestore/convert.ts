/**
 * Converts Firestore values at the repository boundary so `@portfolio/core` never sees SDK types
 * (LLD §1.1): any object with `toMillis()` (a Timestamp) becomes epoch ms, recursively.
 */
export function timestampsToMillis(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if ('toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (Array.isArray(value)) return value.map(timestampsToMillis);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = timestampsToMillis(v);
  return out;
}
