import {
  EXCHANGES,
  LABELS,
  MARKETS,
  NO_FILTERS,
  type KeyValueCache,
  type PortfolioFilters,
} from '@portfolio/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

const UI_PORTFOLIO_KEY = 'ui.portfolio';

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
  setPortfolioFilters(filters: PortfolioFilters): void;
  toggleSector(sector: string): void;
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
  return createStore<UiState>()((set, get) => {
    const persist = (): void => {
      const s = get();
      kv.set(UI_PORTFOLIO_KEY, { filters: s.portfolioFilters, collapsedSectors: s.collapsedSectors });
    };
    return {
      portfolioFilters: saved?.filters ?? NO_FILTERS,
      collapsedSectors: saved?.collapsedSectors ?? [],
      setPortfolioFilters: (portfolioFilters) => {
        set({ portfolioFilters });
        persist();
      },
      toggleSector: (sector) => {
        const c = get().collapsedSectors;
        set({ collapsedSectors: c.includes(sector) ? c.filter((x) => x !== sector) : [...c, sector] });
        persist();
      },
      reset: () => set({ portfolioFilters: NO_FILTERS, collapsedSectors: [] }),
    };
  });
}
