/**
 * Rounds to `dp` decimal places (half away from zero). Used for prompts and display only, never
 * storage. The scaled value is first normalised to 15 significant digits so binary noise
 * (1.005 × 100 = 100.49999999999999) still rounds the way a person expects (1.01).
 */
export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  const scaled = Number((Math.abs(value) * f).toPrecision(15));
  return (Math.sign(value) * Math.round(scaled)) / f;
}

/** Rounds a nullable number. */
export function roundOrNull(value: number | null, dp = 2): number | null {
  return value === null ? null : round(value, dp);
}

/** True for finite numbers (rejects NaN and ±Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Arithmetic mean, or `null` for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Sample standard deviation (n − 1), or `null` with fewer than 2 values. */
export function sampleStdev(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

/** Percentage change from `from` to `to`, or `null` when `from` is zero/missing. */
export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to / from - 1) * 100;
}
