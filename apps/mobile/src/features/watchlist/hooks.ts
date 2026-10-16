import { toInstrumentKey, type InstrumentKey } from '@portfolio/core';
import { useMemo } from 'react';

import { useAiSuggestions } from '@/features/analysis/ai';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { useAi, useAnalysis, useInstruments, useMarket, useUi, useWatchlists } from '@/stores';
import { buildWatchlistRows, filterWatchlistRows, type WatchlistView } from './rows';

/** S07 rows for a list, filtered by the saved chips (LLD §4.3 `useWatchlistView`). */
export function useWatchlistView(listId: string | null): WatchlistView {
  const items = useWatchlists((s) => (listId ? s.itemsByList[listId] : undefined));
  const snapshots = useMarket((s) => s.snapshots);
  const analysis = useAnalysis((s) => s.byKey);
  const signals = useAi((s) => s.signals);
  const suggestions = useAiSuggestions();
  const filters = useUi((s) => s.watchlistFilters);
  const listVersion = useInstruments((s) => s.meta?.version);
  return useMemo(() => {
    const index = listVersion ? getInstrumentIndex() : null;
    const rows = buildWatchlistRows({
      items: items ?? [],
      snapshots,
      analysis,
      signals,
      suggestions,
      nameOf: (k) => index?.byKey.get(k)?.instrument.name ?? null,
    });
    return filterWatchlistRows(rows, suggestions ? filters : { ...filters, signal: null });
  }, [items, snapshots, analysis, signals, suggestions, filters, listVersion]);
}

/** IDs of the lists holding an instrument (watchlist-pick, S04 ★ state). */
export function useListsContaining(key: InstrumentKey | null): readonly string[] {
  const watchlists = useWatchlists((s) => s.watchlists);
  const itemsByList = useWatchlists((s) => s.itemsByList);
  return useMemo(
    () =>
      key
        ? watchlists
            .filter((l) =>
              (itemsByList[l.id] ?? []).some((i) => toInstrumentKey(i.exchange, i.symbol) === key),
            )
            .map((l) => l.id)
        : [],
    [key, watchlists, itemsByList],
  );
}
