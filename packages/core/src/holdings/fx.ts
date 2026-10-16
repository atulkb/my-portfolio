import type { Currency, IsoDate } from '../models/primitives';
import { indexOnOrBefore } from '../util/dates';
import type { FxContext } from './types';

/** Converts an amount between INR and USD at `usdInr` (INR per USD). */
export function convert(amount: number, from: Currency, to: Currency, usdInr: number): number {
  if (from === to) return amount;
  return from === 'USD' ? amount * usdInr : amount / usdInr;
}

/**
 * USD/INR on `date` from the history: nearest earlier rate, or the first available rate when
 * the date predates the history (ECB INR starts in 1999). `null` only for an empty history.
 */
export function rateOn(fx: FxContext, date: IsoDate): number | null {
  if (fx.history.length === 0) return null;
  const i = indexOnOrBefore(fx.history, date);
  return (fx.history[Math.max(i, 0)] ?? fx.history[0])?.rate ?? null;
}
