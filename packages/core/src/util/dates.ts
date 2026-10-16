import type { IsoDate } from '../models/primitives';

const DAY_MS = 86_400_000;

function toUtcMs(d: IsoDate): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Adds `n` calendar days (negative to subtract). */
export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(d) + n * DAY_MS);
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function weekday(d: IsoDate): number {
  return new Date(toUtcMs(d)).getUTCDay();
}

/** Latest of the given dates (ISO strings compare lexicographically). */
export function maxDate(dates: readonly IsoDate[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const d of dates) if (best === null || d > best) best = d;
  return best;
}

/** Earliest of the given dates. */
export function minDate(dates: readonly IsoDate[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const d of dates) if (best === null || d < best) best = d;
  return best;
}

/**
 * Index of the last element whose `date` is on or before `target` in an ascending array,
 * or -1 when none is. Binary search.
 */
export function indexOnOrBefore<T extends { readonly date: IsoDate }>(
  rows: readonly T[],
  target: IsoDate,
): number {
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid];
    if (row !== undefined && row.date <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
