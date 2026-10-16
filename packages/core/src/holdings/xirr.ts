import type { IsoDate } from '../models/primitives';
import { daysBetween } from '../util/dates';

/** Dated cash flow: buys negative, terminal value positive. */
export type Cashflow = { readonly date: IsoDate; readonly amount: number };

/** Minimum span (days) before a return is annualised (ANALYSIS_FRAMEWORK §4.1). */
export const MIN_XIRR_SPAN_DAYS = 365;

const TOLERANCE = 1e-7;
const MAX_ITERATIONS = 100;
const LOW = -0.9999;
const HIGH = 100;

/**
 * Money-weighted annualised return (LLD §2.4) as a fraction (0.12 = 12 %).
 * Newton–Raphson from 0.1, falling back to bisection on [−0.9999, 100]; both loops are
 * capped at 100 iterations. Returns `null` with fewer than 2 flows, no sign change, no root
 * in the bracket, or a span shorter than 365 days.
 */
export function xirr(flows: readonly Cashflow[]): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || daysBetween(first.date, last.date) < MIN_XIRR_SPAN_DAYS) return null;
  if (!sorted.some((f) => f.amount < 0) || !sorted.some((f) => f.amount > 0)) return null;

  const years = sorted.map((f) => daysBetween(first.date, f.date) / 365);
  const npv = (r: number): number => sorted.reduce((s, f, i) => s + f.amount / (1 + r) ** (years[i] ?? 0), 0);
  const dnpv = (r: number): number =>
    sorted.reduce((s, f, i) => {
      const t = years[i] ?? 0;
      return s - (t * f.amount) / (1 + r) ** (t + 1);
    }, 0);

  let r = 0.1;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const f = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || Math.abs(d) < 1e-12) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= LOW || next > HIGH) break;
    if (Math.abs(next - r) < TOLERANCE) return next;
    r = next;
  }
  return bisect(npv);
}

function bisect(npv: (r: number) => number): number | null {
  let lo = LOW;
  let hi = HIGH;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < TOLERANCE || (hi - lo) / 2 < TOLERANCE) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}
