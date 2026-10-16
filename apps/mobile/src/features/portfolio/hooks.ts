import {
  aggregateHoldings,
  NO_FILTERS,
  type InstrumentKey,
  type PricingContext,
  type StockHolding,
} from '@portfolio/core';
import { useMemo } from 'react';

import { localIsoDate } from '@/lib/dates';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { useInstruments, usePortfolio, useSession } from '@/stores';

/**
 * Pricing context without market data (M4): no snapshots, so values/P&L are `null` (never 0).
 * M5 replaces this with `usePricingContext()` (LLD §4.3). The FX rate is only used to compare
 * values across currencies, which are all null here.
 */
function costBasisContext(sectorOf: (key: InstrumentKey) => string | null): PricingContext {
  return {
    valuationDate: localIsoDate(),
    snapshots: new Map(),
    fx: { usdInr: 1, asOf: localIsoDate(), history: [] },
    sectorOf,
    labels: new Map(),
  };
}

/** Holdings derived from the buy transactions, sorted by name (LLD §2.3). */
export function useHoldings(): readonly StockHolding[] {
  const transactions = usePortfolio((s) => s.transactions);
  const overrides = useSession((s) => s.profile?.sectorOverrides);
  // Re-read the index when the stock list (master industry) loads or updates.
  const listVersion = useInstruments((s) => s.meta?.version);
  const index = listVersion ? getInstrumentIndex() : null;
  return useMemo(() => {
    // Sector: user override → master-list industry (BSE) → null; provider profiles join in M6.
    const sectorOf = (key: InstrumentKey): string | null =>
      overrides?.[key] ?? index?.byKey.get(key)?.instrument.industry ?? null;
    return aggregateHoldings(transactions, costBasisContext(sectorOf), { ...NO_FILTERS, sort: 'NAME_ASC' });
  }, [transactions, overrides, index]);
}

/** One holding (all brokers, unfiltered) for S02b / S02c; null when the stock has no buys. */
export function useHolding(key: InstrumentKey | null): StockHolding | null {
  const holdings = useHoldings();
  return useMemo(() => holdings.find((h) => h.key === key) ?? null, [holdings, key]);
}
