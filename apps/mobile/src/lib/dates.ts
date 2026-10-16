import { sessionDateFor, type IsoDate } from '@portfolio/core';

/** The device's local calendar date as `YYYY-MM-DD` (trade dates are entered in local time). */
export function localIsoDate(d: Date = new Date()): IsoDate {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-midnight `Date` for an ISO date (for date pickers). */
export function dateFromIso(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1990, (m ?? 1) - 1, d ?? 1);
}

/**
 * The most recent closed session of either market (IN or US). Used for the market note and as
 * the session date of rule results (LLD §1.7).
 */
export function latestSessionDate(now: number): IsoDate {
  const a = sessionDateFor('IN', now);
  const b = sessionDateFor('US', now);
  return a > b ? a : b;
}
