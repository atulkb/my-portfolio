import type { IsoDate } from '@portfolio/core';

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
