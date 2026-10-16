import type { FxContext, InstrumentKey, InstrumentRef, IsoDate } from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { FxResult } from '@/services/fx/fxService';
import type { PricedSnapshot } from '@/services/market-data/marketDataService';
import type { RefreshReport, RefreshService } from '@/services/refresh/refreshService';

/** Market store state (LLD §4.3). */
export type MarketState = {
  readonly snapshots: ReadonlyMap<InstrumentKey, PricedSnapshot>;
  readonly fx: FxContext | null;
  readonly fxSource: FxResult['source'] | null;
  readonly refresh: {
    readonly running: boolean;
    readonly progress: { readonly done: number; readonly total: number } | null;
    readonly report: RefreshReport | null;
    readonly lastAt: number | null;
  };
  /** Shows cached prices and FX at once (no network). */
  hydrate(refs: readonly InstrumentRef[]): void;
  /** Runs the refresh pipeline; a second call while running joins the first. */
  runRefresh(input: {
    readonly refs: readonly InstrumentRef[];
    readonly earliestBuy: IsoDate | null;
    readonly force: boolean;
  }): Promise<void>;
  reset(): void;
};

/** Creates the market store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createMarketStore(deps: {
  readonly refresh: RefreshService;
  readonly now: () => number;
}): StoreApi<MarketState> {
  let running: Promise<void> | null = null;
  const idle = { running: false, progress: null, report: null, lastAt: null };

  return createStore<MarketState>()((set) => ({
    snapshots: new Map(),
    fx: null,
    fxSource: null,
    refresh: idle,

    hydrate: (refs) => {
      const { snapshots, fx } = deps.refresh.cached(refs);
      set((s) => ({
        snapshots: new Map([...s.snapshots, ...snapshots]),
        ...(fx && !s.fx ? { fx: fx.context, fxSource: fx.source } : {}),
      }));
    },

    runRefresh: (input) => {
      running ??= (async () => {
        set((s) => ({
          refresh: { ...s.refresh, running: true, progress: { done: 0, total: input.refs.length } },
        }));
        try {
          const out = await deps.refresh.refresh({
            ...input,
            onProgress: (done, total) =>
              set((s) => ({ refresh: { ...s.refresh, progress: { done, total } } })),
          });
          set((s) => ({
            snapshots: new Map([...s.snapshots, ...out.snapshots]),
            ...(out.fx ? { fx: out.fx.context, fxSource: out.fx.source } : {}),
            refresh: { running: false, progress: null, report: out.report, lastAt: deps.now() },
          }));
        } catch {
          set((s) => ({ refresh: { ...s.refresh, running: false, progress: null } }));
        }
      })().finally(() => {
        running = null;
      });
      return running;
    },

    reset: () => set({ snapshots: new Map(), fx: null, fxSource: null, refresh: idle }),
  }));
}
