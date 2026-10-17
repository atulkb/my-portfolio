import { wordCount } from '../util/text';

/**
 * Numbers that may appear in prose without being in the payload: indicator periods and index
 * names ("RSI (14)", "200-day", "52-week", "Nifty 50", "S&P 500"). Integers 0–10 are always
 * allowed ("2 risks", "1 year").
 */
export const GROUNDING_CONSTANTS: readonly number[] = [
  12, 14, 20, 26, 30, 50, 52, 90, 100, 200, 252, 365, 500,
];

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Extracts numbers written in prose. Thousands separators (Western or Indian) are removed; digits
 * glued to a preceding letter ("FY26", "Q3") are skipped as identifiers.
 */
export function extractNumbers(text: string): { value: number; decimals: number }[] {
  const out: { value: number; decimals: number }[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const start = m.index ?? 0;
    const before = start > 0 ? text[start - 1] : '';
    if (before && /[A-Za-z]/.test(before)) continue;
    const raw = m[0].replace(/,/g, '').replace(/\.$/, '');
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const dot = raw.indexOf('.');
    out.push({ value, decimals: dot === -1 ? 0 : raw.length - dot - 1 });
  }
  return out;
}

/** Recursively collects every finite number in a JSON-like payload. */
export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value)) collectNumbers(v, out);
  return out;
}

/**
 * Checks that every number in `text` matches an allowed value after rounding to the number of
 * decimals written (0–2; signs ignored). Returns the stray numbers; empty = grounded.
 */
export function strayNumbers(text: string, allowed: readonly number[]): number[] {
  const sets = [new Set<string>(), new Set<string>(), new Set<string>()];
  for (const a of [...allowed, ...GROUNDING_CONSTANTS]) {
    const abs = Math.abs(a);
    for (let d = 0; d <= 2; d++) sets[d]?.add(abs.toFixed(d));
  }
  const stray: number[] = [];
  for (const { value, decimals } of extractNumbers(text)) {
    if (decimals === 0 && value <= 10) continue;
    const d = Math.min(decimals, 2);
    if (!sets[d]?.has(value.toFixed(d))) stray.push(value);
  }
  return stray;
}

/** Identifier-like names (camelCase or letters+digits, e.g. `pnlPct`, `trend200`), never prose words. */
const IDENTIFIER_RE = /^[a-z]+(?:[A-Z][A-Za-z0-9]*|\d+[A-Za-z0-9]*)+$/;

/**
 * Field names of a payload that must not appear in prose: object keys and `key` values (parameter
 * keys such as `trend200`), limited to identifier-like names.
 */
export function collectFieldNames(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) collectFieldNames(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (IDENTIFIER_RE.test(k)) out.add(k);
      if (k === 'key' && typeof v === 'string' && IDENTIFIER_RE.test(v)) out.add(v);
      collectFieldNames(v, out);
    }
  }
  return out;
}

/**
 * Validation error text for a prose field, or `null` when it passes length, grounding and (with
 * `fieldNames`) the no-field-names check.
 */
export function checkProse(
  field: string,
  text: string,
  maxWords: number,
  allowed: readonly number[],
  fieldNames: ReadonlySet<string> = new Set(),
): string | null {
  if (wordCount(text) > maxWords) return `${field} is longer than ${maxWords} words.`;
  const stray = strayNumbers(text, allowed);
  if (stray.length > 0) return `${field} mentions numbers not in the data: ${stray.join(', ')}.`;
  const named = text.match(/[A-Za-z][A-Za-z0-9]*/g)?.filter((w) => fieldNames.has(w)) ?? [];
  if (named.length > 0)
    return `${field} uses data field names (${[...new Set(named)].join(', ')}); describe them in plain words.`;
  return null;
}
