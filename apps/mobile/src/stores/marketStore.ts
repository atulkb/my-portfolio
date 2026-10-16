import type {
  AppErrorCode,
  Fundamentals,
  FxContext,
  InstrumentKey,
  InstrumentProfile,
  InstrumentRef,
  IsoDate,
  MacroSnapshot,
  Market,
} from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { FxResult } from '@/services/fx/fxService';
import type { PricedSnapshot } from '@/services/market-data/marketDataService';
import type {
  IndexHistories,
  MarketData,
  RefreshReport,
  RefreshService,
} from '@/services/refresh/refreshService';

/** Loading state of an instrument opened in Research that isn't covered by the refresh. */
export type InstrumentLoad = { readonly state: 'loading' | 'ready'; readonly failure: AppErrorCode | null };

/** Market store state (LLD §4.3). */
export type MarketState = {
  readonly snapshots: ReadonlyMap<InstrumentKey, PricedSnapshot>;
  readonly fx: FxContext | null;
  readonly fxSource: FxResult['source'] | null;
  /** `null` value = fetched, no data (shown as ⚪); missing key = not fetched yet. */
  readonly fundamentals: ReadonlyMap<InstrumentKey, Fundamentals | null>;
  readonly profiles: ReadonlyMap<InstrumentKey, InstrumentProfile>;
  readonly macro: MacroSnapshot | null;
  readonly indexHistory: IndexHistories;
  readonly instrumentLoads: ReadonlyMap<InstrumentKey, InstrumentLoad>;
  readonly refresh: {
    readonly running: boolean;
    readonly progress: { readonly done: number; readonly total: number } | null;
    readonly report: RefreshReport | null;
    readonly lastAt: number | null;
  };
  /** Shows cached prices, FX, fundamentals and profiles at once (no network). */
  hydrate(refs: readonly InstrumentRef[]): void;
  /** Runs the refresh pipeline; a second call while running joins the first. */
  runRefresh(input: {
    readonly refs: readonly InstrumentRef[];
    readonly earliestBuy: IsoDate | null;
    readonly earliestBuyByMarket: Readonly<Partial<Record<Market, IsoDate>>>;
    readonly force: boolean;
  }): Promise<void>;
  /** Loads one instrument for Research (cache first, then network); no-op while loading. */
  loadInstrument(ref: InstrumentRef): Promise<void>;
  reset(): void;
};

const merge = <K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): Map<K, V> => new Map([...a, ...b]);

/** Creates the market store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createMarketStore(deps: {
  readonly refresh: RefreshService;
  readonly now: () => number;
}): StoreApi<MarketState> {
  let running: Promise<void> | null = null;
  const idle = { running: false, progress: null, report: null, lastAt: null };
  const empty = {
    snapshots: new Map(),
    fx: null,
    fxSource: null,
    fundamentals: new Map(),
    profiles: new Map(),
    macro: null,
    indexHistory: {},
    instrumentLoads: new Map(),
    refresh: idle,
  } as const;

  return createStore<MarketState>()((set, get) => {
    const apply = (data: MarketData, s: MarketState) => ({
      snapshots: merge(s.snapshots, data.snapshots),
      fundamentals: merge(s.fundamentals, data.fundamentals),
      profiles: merge(s.profiles, data.profiles),
      macro: data.macro,
      indexHistory: { ...s.indexHistory, ...data.indexHistory },
    });

    return {
      ...empty,

      hydrate: (refs) => {
        const data = deps.refresh.cached(refs);
        set((s) => ({
          ...apply(data, s),
          macro: s.macro ?? data.macro,
          ...(data.fx && !s.fx ? { fx: data.fx.context, fxSource: data.fx.source } : {}),
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
              onPrices: ({ snapshots, fx }) =>
                set((s) => ({
                  snapshots: merge(s.snapshots, snapshots),
                  ...(fx ? { fx: fx.context, fxSource: fx.source } : {}),
                  refresh: { ...s.refresh, progress: null },
                })),
            });
            set((s) => ({
              ...apply(out, s),
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

      loadInstrument: async (ref) => {
        const key = ref.key as InstrumentKey;
        if (get().instrumentLoads.get(key)?.state === 'loading') return;
        const setLoad = (load: InstrumentLoad) =>
          set((s) => ({ instrumentLoads: new Map(s.instrumentLoads).set(key, load) }));
        // Cached values first so the screen renders at once.
        const cached = deps.refresh.cached([ref]);
        set((s) => ({
          snapshots: merge(s.snapshots, cached.snapshots),
          fundamentals: merge(s.fundamentals, cached.fundamentals),
          profiles: merge(s.profiles, cached.profiles),
        }));
        setLoad({ state: 'loading', failure: null });
        try {
          const r = await deps.refresh.instrument(ref);
          set((s) => {
            const snapshots = new Map(s.snapshots);
            const fundamentals = new Map(s.fundamentals);
            const profiles = new Map(s.profiles);
            if (r.snapshot) snapshots.set(key, r.snapshot);
            if (ref.type === 'EQUITY') fundamentals.set(key, r.fundamentals);
            if (r.profile) profiles.set(key, r.profile);
            return { snapshots, fundamentals, profiles };
          });
          setLoad({ state: 'ready', failure: r.snapshot ? null : r.failure });
        } catch {
          setLoad({ state: 'ready', failure: 'MD_NETWORK' });
        }
      },

      reset: () => set(empty),
    };
  });
}
