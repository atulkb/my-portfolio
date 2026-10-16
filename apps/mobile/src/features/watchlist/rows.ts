import {
  EXCHANGE_META,
  toInstrumentKey,
  type Currency,
  type Exchange,
  type InstrumentKey,
  type Label,
  type Market,
  type Signal,
  type SignalLabel,
  type WatchlistItem,
} from '@portfolio/core';

import type { AiEntry } from '@/services/ai/aiService';
import type { PricedSnapshot } from '@/services/market-data/marketDataService';
import type { AnalysisEntry } from '@/stores/analysisStore';
import type { WatchlistFilters } from '@/stores/uiStore';

/** Sessions in the row sparkline (~3 months, same as S04). */
const SPARK_SESSIONS = 63;

/** One S07 row (LLD §4.4). */
export type WatchlistRow = {
  readonly key: InstrumentKey;
  readonly symbol: string;
  readonly exchange: Exchange;
  readonly market: Market;
  readonly currency: Currency;
  readonly name: string;
  readonly item: WatchlistItem;
  readonly close: number | null;
  readonly dayChangePct: number | null;
  readonly stale: boolean;
  readonly spark: readonly number[];
  readonly health: Label | null;
  readonly healthScore: number | null;
  /** `null` when AI suggestions are off or no signal exists yet. */
  readonly signal: AiEntry<Signal> | null;
};

/** The S07 view model (`useWatchlistView`). */
export type WatchlistView = {
  readonly rows: readonly WatchlistRow[];
  /** Rows in the list after the market filter, before the signal filter (for chip counts). */
  readonly marketRows: number;
  readonly signalCounts: Readonly<Record<SignalLabel, number>>;
  readonly totalRows: number;
  /** Newest signal time among the list's rows ("Signals as of"). */
  readonly signalsAsOf: number | null;
};

/** Inputs of {@link buildWatchlistRows}. */
export type WatchlistSources = {
  readonly items: readonly WatchlistItem[];
  readonly snapshots: ReadonlyMap<InstrumentKey, PricedSnapshot>;
  readonly analysis: ReadonlyMap<InstrumentKey, AnalysisEntry>;
  readonly signals: Readonly<Record<InstrumentKey, AiEntry<Signal>>>;
  readonly suggestions: boolean;
  readonly nameOf: (key: InstrumentKey) => string | null;
};

/** Rows for one list in the order stocks were added (pure; tested). */
export function buildWatchlistRows(src: WatchlistSources): WatchlistRow[] {
  return [...src.items]
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((item) => {
      const key = toInstrumentKey(item.exchange, item.symbol);
      const snap = src.snapshots.get(key) ?? null;
      const entry = src.analysis.get(key) ?? null;
      const meta = EXCHANGE_META[item.exchange];
      const prev = snap?.prevClose ?? null;
      return {
        key,
        symbol: item.symbol,
        exchange: item.exchange,
        market: meta.market,
        currency: meta.currency,
        name: src.nameOf(key) ?? item.symbol,
        item,
        close: snap?.close ?? null,
        dayChangePct: snap && prev ? ((snap.close - prev) / prev) * 100 : null,
        stale: snap?.stale ?? false,
        spark: snap ? snap.bars.slice(-SPARK_SESSIONS).map((b) => b.adjClose) : [],
        health: entry?.analysis.healthLabel ?? null,
        healthScore: entry?.analysis.healthScore ?? null,
        signal: src.suggestions ? (src.signals[key] ?? null) : null,
      };
    });
}

/** Applies the market and signal chips and counts signals (pure; tested). */
export function filterWatchlistRows(rows: readonly WatchlistRow[], f: WatchlistFilters): WatchlistView {
  const byMarket = f.market ? rows.filter((r) => r.market === f.market) : [...rows];
  const signalCounts: Record<SignalLabel, number> = { STRONG_BUY: 0, BUY: 0, HOLD: 0, TRIM: 0, SELL: 0 };
  let signalsAsOf: number | null = null;
  for (const r of byMarket) {
    if (!r.signal) continue;
    signalCounts[r.signal.value.label] += 1;
    if (signalsAsOf === null || r.signal.createdAt > signalsAsOf) signalsAsOf = r.signal.createdAt;
  }
  return {
    rows: f.signal ? byMarket.filter((r) => r.signal?.value.label === f.signal) : byMarket,
    marketRows: byMarket.length,
    signalCounts,
    totalRows: rows.length,
    signalsAsOf,
  };
}
