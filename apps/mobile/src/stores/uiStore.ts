import {
  EXCHANGES,
  LABELS,
  MARKETS,
  NO_FILTERS,
  InstrumentKeySchema,
  SIGNAL_LABELS,
  type InstrumentKey,
  type KeyValueCache,
  type PortfolioFilters,
} from '@portfolio/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

const UI_PORTFOLIO_KEY = 'ui.portfolio';
const UI_RESEARCH_KEY = 'ui.research';
const UI_WATCHLIST_KEY = 'ui.watchlist';
/** Recently viewed instruments kept on the Research start screen. */
export const MAX_RECENT_RESEARCH = 10;
const UiResearchSchema = z.object({ recent: z.array(InstrumentKeySchema) });

const WatchlistFiltersSchema = z.object({
  market: z.enum(MARKETS).nullable(),
  signal: z.enum(SIGNAL_LABELS).nullable(),
});
/** S07 filters (LLD §4.3): market chip and signal chip; `null` = All. */
export type WatchlistFilters = z.infer<typeof WatchlistFiltersSchema>;
const NO_WATCHLIST_FILTERS: WatchlistFilters = { market: null, signal: null };

const LabelFilterSchema = z.enum([...LABELS, 'NONE']);
const PortfolioFiltersSchema = z.object({
  platforms: z.array(z.string()),
  markets: z.array(z.enum(MARKETS)),
  exchanges: z.array(z.enum(EXCHANGES)),
  sectors: z.array(z.string()),
  performance: z.array(LabelFilterSchema),
  health: z.array(LabelFilterSchema),
  sort: z.enum(['VALUE_DESC', 'DAY_PNL_PCT_DESC', 'PNL_PCT_DESC', 'WEIGHT_DESC', 'NAME_ASC']),
});
const UiPortfolioSchema = z.object({
  filters: PortfolioFiltersSchema,
  collapsedSectors: z.array(z.string()),
});

/** UI preferences (LLD §4.3), persisted to MMKV `ui.*`. */
export type UiState = {
  readonly portfolioFilters: PortfolioFilters;
  readonly collapsedSectors: readonly string[];
  /** Most recent first. */
  readonly recentResearch: readonly InstrumentKey[];
  readonly watchlistFilters: WatchlistFilters;
  setWatchlistFilters(filters: WatchlistFilters): void;
  setPortfolioFilters(filters: PortfolioFilters): void;
  toggleSector(sector: string): void;
  /** Moves `key` to the front of the recently viewed list. */
  addRecentResearch(key: InstrumentKey): void;
  reset(): void;
};

/** True when any filter (not the sort) is active — the dot on the Filters button. */
export function hasActiveFilters(f: PortfolioFilters): boolean {
  return (
    f.platforms.length +
      f.markets.length +
      f.exchanges.length +
      f.sectors.length +
      f.performance.length +
      f.health.length >
    0
  );
}

/** Creates the UI store, restoring saved preferences. */
export function createUiStore(kv: KeyValueCache): StoreApi<UiState> {
  const saved = kv.get(UI_PORTFOLIO_KEY, UiPortfolioSchema);
  const research = kv.get(UI_RESEARCH_KEY, UiResearchSchema);
  const watch = kv.get(UI_WATCHLIST_KEY, WatchlistFiltersSchema);
  return createStore<UiState>()((set, get) => {
    const persist = (): void => {
      const s = get();
      kv.set(UI_PORTFOLIO_KEY, { filters: s.portfolioFilters, collapsedSectors: s.collapsedSectors });
    };
    return {
      portfolioFilters: saved?.filters ?? NO_FILTERS,
      collapsedSectors: saved?.collapsedSectors ?? [],
      recentResearch: research?.recent ?? [],
      watchlistFilters: watch ?? NO_WATCHLIST_FILTERS,
      setWatchlistFilters: (watchlistFilters) => {
        set({ watchlistFilters });
        kv.set(UI_WATCHLIST_KEY, watchlistFilters);
      },
      setPortfolioFilters: (portfolioFilters) => {
        set({ portfolioFilters });
        persist();
      },
      toggleSector: (sector) => {
        const c = get().collapsedSectors;
        set({ collapsedSectors: c.includes(sector) ? c.filter((x) => x !== sector) : [...c, sector] });
        persist();
      },
      addRecentResearch: (key) => {
        if (get().recentResearch[0] === key) return;
        const recent = [key, ...get().recentResearch.filter((k) => k !== key)].slice(0, MAX_RECENT_RESEARCH);
        set({ recentResearch: recent });
        kv.set(UI_RESEARCH_KEY, { recent });
      },
      reset: () =>
        set({
          portfolioFilters: NO_FILTERS,
          collapsedSectors: [],
          recentResearch: [],
          watchlistFilters: NO_WATCHLIST_FILTERS,
        }),
    };
  });
}
