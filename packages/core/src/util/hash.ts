/**
 * Canonical JSON: object keys sorted recursively, so equal values always serialise identically.
 * `undefined` object members are dropped (as in JSON.stringify).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex chars. Not cryptographic; used for cache keys. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Stable hash of any JSON-compatible value (LLD §3.5 AI cache `inputHash`). */
export function hashInput(value: unknown): string {
  return fnv1a(canonicalJson(value));
}
