import type { DailyBar } from '../market/types';
import type { IsoDate, Market } from '../models/primitives';
import { indexOnOrBefore } from '../util/dates';
import { xirr, type Cashflow } from './xirr';

/** Benchmark index per market (ANALYSIS_FRAMEWORK §4.1). Price indices: dividends not included (HLD D33). */
export const BENCHMARK_FOR_MARKET: Readonly<Record<Market, { index: 'NIFTY50' | 'SP500'; name: string }>> = {
  IN: { index: 'NIFTY50', name: 'Nifty 50' },
  US: { index: 'SP500', name: 'S&P 500' },
};

/** Result of investing the same amounts in the index on the same dates. */
export type BenchmarkResult = {
  readonly benchValue: number;
  readonly benchPnlPct: number;
  /** Annualised; `null` when the first buy is less than a year old. */
  readonly benchXirrPct: number | null;
};

/** A buy expressed as a positive amount on its trade date. */
export type BuyAmount = { readonly date: IsoDate; readonly amount: number };

function closeOnOrBefore(bars: readonly DailyBar[], date: IsoDate): number | null {
  const i = indexOnOrBefore(bars, date);
  const bar = i >= 0 ? bars[i] : undefined;
  return bar && bar.adjClose > 0 ? bar.adjClose : null;
}

/**
 * "Same amounts on the same dates" benchmark (LLD §2.5). `indexBars` must be ascending
 * adjusted-close history reaching back to the first buy; a buy on a holiday uses the previous
 * close. Returns `null` when the history does not cover every buy or the valuation date.
 */
export function benchmarkReturn(
  buys: readonly BuyAmount[],
  indexBars: readonly DailyBar[],
  valuationDate: IsoDate,
): BenchmarkResult | null {
  if (buys.length === 0) return null;
  const endClose = closeOnOrBefore(indexBars, valuationDate);
  if (endClose === null) return null;

  let units = 0;
  let invested = 0;
  for (const b of buys) {
    const c = closeOnOrBefore(indexBars, b.date);
    if (c === null) return null;
    units += b.amount / c;
    invested += b.amount;
  }
  if (invested <= 0) return null;

  const benchValue = units * endClose;
  const flows: Cashflow[] = [
    ...buys.map((b) => ({ date: b.date, amount: -b.amount })),
    { date: valuationDate, amount: benchValue },
  ];
  const r = xirr(flows);
  return {
    benchValue,
    benchPnlPct: (benchValue / invested - 1) * 100,
    benchXirrPct: r === null ? null : r * 100,
  };
}

/**
 * Like-for-like excess return in percentage points: annualised vs annualised when both exist,
 * otherwise absolute vs absolute. `null` when either side is missing.
 */
export function excessReturnPp(
  holding: { readonly xirrPct: number | null; readonly pnlPct: number | null },
  bench: BenchmarkResult | null,
): number | null {
  if (bench === null) return null;
  if (holding.xirrPct !== null && bench.benchXirrPct !== null) return holding.xirrPct - bench.benchXirrPct;
  if (holding.pnlPct === null) return null;
  return holding.pnlPct - bench.benchPnlPct;
}

/** The benchmark return shown to the user and sent to Gemini: annualised when available. */
export function benchmarkReturnPct(bench: BenchmarkResult | null): number | null {
  if (bench === null) return null;
  return bench.benchXirrPct ?? bench.benchPnlPct;
}
