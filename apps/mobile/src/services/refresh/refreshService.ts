import type { AppErrorCode, InstrumentKey, InstrumentRef, IsoDate } from '@portfolio/core';

import type { FxResult, FxService } from '../fx/fxService';
import type { HttpClient } from '../http/httpClient';
import type { MarketDataService, PricedSnapshot } from '../market-data/marketDataService';

/** What one refresh did (LLD §3.8 step 10). */
export type RefreshReport = {
  readonly fetched: number;
  readonly fromCache: number;
  readonly stale: readonly InstrumentKey[];
  readonly failed: readonly { readonly key: InstrumentKey; readonly code: AppErrorCode }[];
  readonly fxFromCache: boolean;
  readonly durationMs: number;
};

/** Inputs of one refresh: what to price and how far back FX history must reach. */
export type RefreshInput = {
  readonly refs: readonly InstrumentRef[];
  /** Earliest buy date (FX history for portfolio XIRR); null without holdings. */
  readonly earliestBuy: IsoDate | null;
  readonly force: boolean;
  readonly onProgress?: (done: number, total: number) => void;
};

/** Result of one refresh. */
export type RefreshOutput = {
  readonly snapshots: ReadonlyMap<InstrumentKey, PricedSnapshot>;
  readonly fx: FxResult | null;
  readonly report: RefreshReport;
};

/** Daily refresh pipeline (LLD §3.8). */
export type RefreshService = {
  /** Cached data only: the instant render (step 0). */
  cached(refs: readonly InstrumentRef[]): Pick<RefreshOutput, 'snapshots' | 'fx'>;
  refresh(input: RefreshInput): Promise<RefreshOutput>;
};

/**
 * Creates the refresh service. M5 runs the deterministic steps: prices (holdings), FX latest +
 * history in parallel. Index history and fundamentals/profiles join with M6, rules with M8 and
 * AI with M7. Stock-list sync runs separately (instrument store).
 */
export function createRefreshService(deps: {
  readonly http: HttpClient;
  readonly market: MarketDataService;
  readonly fx: FxService;
  readonly now: () => number;
}): RefreshService {
  return {
    cached(refs) {
      return { snapshots: deps.market.cachedSnapshots(refs), fx: deps.fx.cached() };
    },

    async refresh(input) {
      const started = deps.now();
      deps.http.resetBreakers();
      const [prices, fx] = await Promise.all([
        deps.market.getSnapshots(input.refs, {
          force: input.force,
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        }),
        deps.fx.get({ historyFrom: input.earliestBuy, force: input.force }).catch(() => deps.fx.cached()),
      ]);
      const stale = [...prices.snapshots.values()].filter((s) => s.stale).map((s) => s.key);
      return {
        snapshots: prices.snapshots,
        fx,
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
  };
}
