import {
  computeIndicators,
  type AppErrorCode,
  type DailyBar,
  type Fundamentals,
  type IndexKey,
  type InstrumentKey,
  type InstrumentProfile,
  type InstrumentRef,
  type IsoDate,
  type MacroSnapshot,
  type Market,
} from '@portfolio/core';

import type { FxResult, FxService } from '../fx/fxService';
import type { HttpClient } from '../http/httpClient';
import type { BenchmarkIndex } from '../market-data/cache';
import { INDEX_REFS, type MarketDataService, type PricedSnapshot } from '../market-data/marketDataService';

/** What one refresh did (LLD §3.8 step 10). */
export type RefreshReport = {
  readonly fetched: number;
  readonly fromCache: number;
  readonly stale: readonly InstrumentKey[];
  readonly failed: readonly { readonly key: InstrumentKey; readonly code: AppErrorCode }[];
  readonly fxFromCache: boolean;
  readonly durationMs: number;
};

/** Inputs of one refresh: what to price and how far back FX and benchmark history must reach. */
export type RefreshInput = {
  readonly refs: readonly InstrumentRef[];
  /** Earliest buy date (FX history for portfolio XIRR); null without holdings. */
  readonly earliestBuy: IsoDate | null;
  /** Earliest buy per market (benchmark index history, LLD §2.5). */
  readonly earliestBuyByMarket: Readonly<Partial<Record<Market, IsoDate>>>;
  readonly force: boolean;
  readonly onProgress?: (done: number, total: number) => void;
  /** Called as soon as prices and FX are in, before fundamentals and benchmark (portfolio first). */
  readonly onPrices?: (prices: Pick<RefreshOutput, 'snapshots' | 'fx'>) => void;
};

/** Benchmark history per index (only those with holdings in that market). */
export type IndexHistories = Readonly<Partial<Record<BenchmarkIndex, readonly DailyBar[]>>>;

/** Everything the deterministic pipeline produces (cached or fresh). */
export type MarketData = {
  readonly snapshots: ReadonlyMap<InstrumentKey, PricedSnapshot>;
  readonly fx: FxResult | null;
  readonly fundamentals: ReadonlyMap<InstrumentKey, Fundamentals | null>;
  readonly profiles: ReadonlyMap<InstrumentKey, InstrumentProfile>;
  readonly macro: MacroSnapshot;
  readonly indexHistory: IndexHistories;
};

/** Result of one refresh. */
export type RefreshOutput = MarketData & { readonly report: RefreshReport };

/** Data for one instrument opened in Research (LLD §4.4 S04). */
export type InstrumentData = {
  readonly snapshot: PricedSnapshot | null;
  readonly fundamentals: Fundamentals | null;
  readonly profile: InstrumentProfile | null;
  readonly failure: AppErrorCode | null;
};

/** Daily refresh pipeline (LLD §3.8). */
export type RefreshService = {
  /** Cached data only: the instant render (step 0). */
  cached(refs: readonly InstrumentRef[]): MarketData;
  refresh(input: RefreshInput): Promise<RefreshOutput>;
  /** One instrument not covered by the refresh (Research): one chart call + fundamentals, cached. */
  instrument(ref: InstrumentRef): Promise<InstrumentData>;
};

const INDEX_KEYS: readonly IndexKey[] = ['INDEX:NIFTY50', 'INDEX:SP500', 'INDEX:INDIAVIX', 'INDEX:VIX'];
const BENCHMARK_OF: Readonly<Record<Market, BenchmarkIndex>> = { IN: 'NIFTY50', US: 'SP500' };

/** Macro inputs (ANALYSIS_FRAMEWORK §6) from the index snapshots. */
export function macroFrom(indices: ReadonlyMap<InstrumentKey, PricedSnapshot>): MacroSnapshot {
  const get = (k: IndexKey) => indices.get(k as InstrumentKey) ?? null;
  const trend = (k: IndexKey): MacroSnapshot['nifty'] => {
    const s = get(k);
    return s ? { close: s.close, sma200: computeIndicators(s.bars).sma200 } : null;
  };
  return {
    indiaVix: get('INDEX:INDIAVIX')?.close ?? null,
    vix: get('INDEX:VIX')?.close ?? null,
    nifty: trend('INDEX:NIFTY50'),
    sp500: trend('INDEX:SP500'),
  };
}

/**
 * Creates the refresh service. Runs the deterministic steps of LLD §3.8: holdings prices, index
 * bars (macro) and FX in parallel; then benchmark history and fundamentals/profiles. Rules join
 * with M8 and AI with M7. Stock-list sync runs separately (instrument store).
 */
export function createRefreshService(deps: {
  readonly http: HttpClient;
  readonly market: MarketDataService;
  readonly fx: FxService;
  readonly now: () => number;
}): RefreshService {
  const indexRefs = INDEX_KEYS.map((k) => INDEX_REFS[k]);

  function cachedHistories(markets: Iterable<Market>): IndexHistories {
    const out: Partial<Record<BenchmarkIndex, readonly DailyBar[]>> = {};
    for (const m of markets) {
      const bars = deps.market.cachedIndexHistory(BENCHMARK_OF[m]);
      if (bars) out[BENCHMARK_OF[m]] = bars;
    }
    return out;
  }

  return {
    cached(refs) {
      return {
        snapshots: deps.market.cachedSnapshots(refs),
        fx: deps.fx.cached(),
        fundamentals: deps.market.cachedFundamentals(refs),
        profiles: deps.market.cachedProfiles(refs),
        macro: macroFrom(deps.market.cachedSnapshots(indexRefs)),
        indexHistory: cachedHistories(['IN', 'US']),
      };
    },

    async refresh(input) {
      const started = deps.now();
      deps.http.resetBreakers();
      const [prices, indices, fx] = await Promise.all([
        deps.market.getSnapshots(input.refs, {
          force: input.force,
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        }),
        deps.market.getSnapshots(indexRefs, { force: input.force }),
        deps.fx.get({ historyFrom: input.earliestBuy, force: input.force }).catch(() => deps.fx.cached()),
      ]);
      input.onPrices?.({ snapshots: prices.snapshots, fx });

      const equities = input.refs.filter((r) => r.type !== 'INDEX');
      const histories = Object.entries(input.earliestBuyByMarket) as [Market, IsoDate][];
      const [fundamentals, profiles, indexHistory] = await Promise.all([
        deps.market.getFundamentals(equities),
        deps.market.getProfiles(equities),
        Promise.all(
          histories.map(async ([market, from]) => {
            const index = BENCHMARK_OF[market];
            const bars = await deps.market
              .getIndexHistory(index, from)
              .catch(() => deps.market.cachedIndexHistory(index));
            return [index, bars] as const;
          }),
        ),
      ]);

      const stale = [...prices.snapshots.values()].filter((s) => s.stale).map((s) => s.key);
      return {
        snapshots: prices.snapshots,
        fx,
        fundamentals,
        profiles,
        macro: macroFrom(indices.snapshots),
        indexHistory: Object.fromEntries(indexHistory.filter(([, bars]) => bars !== null)),
        report: {
          fetched: prices.fetched,
          fromCache: prices.snapshots.size - prices.fetched,
          stale,
          failed: prices.failures,
          fxFromCache: fx?.fromCache ?? true,
          durationMs: deps.now() - started,
        },
      };
    },

    async instrument(ref) {
      const key = ref.key as InstrumentKey;
      const prices = await deps.market.getSnapshots([ref], { force: false });
      const [fundamentals, profiles] = await Promise.all([
        deps.market.getFundamentals([ref]),
        deps.market.getProfiles([ref]),
      ]);
      return {
        snapshot: prices.snapshots.get(key) ?? null,
        fundamentals: fundamentals.get(key) ?? null,
        profile: profiles.get(key) ?? null,
        failure: prices.failures[0]?.code ?? null,
      };
    },
  };
}
