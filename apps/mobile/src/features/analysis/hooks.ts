import {
  benchmarkReturn,
  benchmarkReturnPct,
  BENCHMARK_FOR_MARKET,
  EXCHANGE_META,
  excessReturnPp,
  parseInstrumentKey,
  type BenchmarkResult,
  type InstrumentKey,
  type StockHolding,
} from '@portfolio/core';
import { useMemo } from 'react';

import { localIsoDate } from '@/lib/dates';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { analysisStore, instrumentStore, marketStore, sessionStore, useAnalysis, useMarket } from '@/stores';
import type { IndexHistories } from '@/services/refresh/refreshService';
import type { AnalysisEntry, AnalysisRow } from '@/stores/analysisStore';
import { resolveSectorCategory } from './sector';

/** Rows for every priced instrument (holdings and instruments opened in Research). */
function analysisRows(): AnalysisRow[] {
  const m = marketStore.getState();
  const src = {
    overrides: sessionStore.getState().profile?.sectorOverrides,
    profiles: m.profiles,
    index: getInstrumentIndex(),
  };
  const rows: AnalysisRow[] = [];
  for (const [key, snap] of m.snapshots) {
    const parsed = parseInstrumentKey(key);
    if (!parsed) continue;
    rows.push({
      key,
      bars: snap.bars,
      fundamentals: m.fundamentals.has(key) ? m.fundamentals.get(key) : undefined,
      sectorCategory: resolveSectorCategory(key, src),
      market: EXCHANGE_META[parsed.exchange].market,
    });
  }
  return rows;
}

/** Recomputes indicators and Health for instruments whose inputs changed. */
export function recomputeAnalysis(): void {
  analysisStore.getState().recompute(analysisRows(), marketStore.getState().macro);
}

/**
 * Keeps the analysis store in step with market data, sector overrides and the stock list.
 * Returns the unsubscribe function (call from the signed-in layout).
 */
export function startAnalysisSync(): () => void {
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      recomputeAnalysis();
    });
  };
  const subs = [
    marketStore.subscribe((s, p) => {
      if (
        s.snapshots !== p.snapshots ||
        s.fundamentals !== p.fundamentals ||
        s.profiles !== p.profiles ||
        s.macro !== p.macro
      )
        schedule();
    }),
    sessionStore.subscribe((s, p) => {
      if (s.profile?.sectorOverrides !== p.profile?.sectorOverrides) schedule();
    }),
    instrumentStore.subscribe((s, p) => {
      if (s.meta?.version !== p.meta?.version) schedule();
    }),
  ];
  schedule();
  return () => subs.forEach((u) => u());
}

/** Indicators + analysis of one instrument; `null` until it has price data. */
export function useAnalysisEntry(key: InstrumentKey | null): AnalysisEntry | null {
  return useAnalysis((s) => (key ? (s.byKey.get(key) ?? null) : null));
}

/** "Your position" extras on S04: benchmark over the same buys, and the excess return. */
export type PositionBenchmark = {
  readonly name: string;
  readonly result: BenchmarkResult | null;
  /** Annualised when available, else absolute (matches the holding's return basis). */
  readonly returnPct: number | null;
  readonly excessPp: number | null;
};

/** Benchmark for a holding (LLD §2.5): same amounts on the same dates in Nifty 50 / S&P 500. */
export function positionBenchmark(holding: StockHolding, histories: IndexHistories): PositionBenchmark {
  const bench = BENCHMARK_FOR_MARKET[holding.market];
  const bars = histories[bench.index];
  const buys = holding.brokers
    .flatMap((b) => b.buys)
    .map((t) => ({ date: t.tradeDate, amount: t.quantity * t.price }));
  const result = bars ? benchmarkReturn(buys, bars, holding.priceDate ?? localIsoDate()) : null;
  return {
    name: bench.name,
    result,
    returnPct: benchmarkReturnPct(result),
    excessPp: excessReturnPp(holding, result),
  };
}

/** {@link positionBenchmark} for S04, memoised on the holding and the index histories. */
export function usePositionBenchmark(holding: StockHolding | null): PositionBenchmark | null {
  const histories = useMarket((s) => s.indexHistory);
  return useMemo(() => (holding ? positionBenchmark(holding, histories) : null), [holding, histories]);
}
