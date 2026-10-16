import {
  aggregateHoldings,
  EXCHANGE_META,
  groupBySector,
  NO_FILTERS,
  parseInstrumentKey,
  summarisePortfolio,
  toInstrumentKey,
  type BuyTransaction,
  type Currency,
  type FxContext,
  type InstrumentKey,
  type InstrumentRef,
  type IsoDate,
  type Label,
  type Market,
  type PortfolioSummary,
  type PricingContext,
  type SectorGroup,
  type StockHolding,
} from '@portfolio/core';
import { useMemo } from 'react';

import { resolveSector, type SectorSources } from '@/features/analysis/sector';
import { localIsoDate } from '@/lib/dates';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import {
  aiStore,
  analysisStore,
  marketStore,
  portfolioStore,
  sessionStore,
  useAi,
  useAnalysis,
  useInstruments,
  useMarket,
  usePortfolio,
  useSession,
  useUi,
} from '@/stores';
import type { AnalysisEntry } from '@/stores/analysisStore';

/** Placeholder rate while no FX is known: converted totals become NaN and display as "—". */
const NO_FX: FxContext = { usdInr: Number.NaN, asOf: '1970-01-01', history: [] };

/** Provider request for a holding, from the stock list when available (LLD §3.1). */
export function refFor(key: InstrumentKey): InstrumentRef | null {
  const parsed = parseInstrumentKey(key);
  if (!parsed) return null;
  const hit = getInstrumentIndex()?.byKey.get(key);
  return {
    key,
    symbol: parsed.symbol,
    exchange: parsed.exchange,
    bseCode: hit?.listing.providerCode ?? null,
    type: hit?.instrument.type ?? 'EQUITY',
  };
}

function holdingKeys(txs: readonly BuyTransaction[]): InstrumentKey[] {
  return [...new Set(txs.map((t) => toInstrumentKey(t.exchange, t.symbol)))];
}

function earliestBuy(txs: readonly BuyTransaction[]): IsoDate | null {
  let min: IsoDate | null = null;
  for (const t of txs) if (min === null || t.tradeDate < min) min = t.tradeDate;
  return min;
}

function earliestBuyByMarket(txs: readonly BuyTransaction[]): Partial<Record<Market, IsoDate>> {
  const out: Partial<Record<Market, IsoDate>> = {};
  for (const t of txs) {
    const m = EXCHANGE_META[t.exchange].market;
    const cur = out[m];
    if (cur === undefined || t.tradeDate < cur) out[m] = t.tradeDate;
  }
  return out;
}

/** Refs for every held instrument. */
export function currentRefs(): InstrumentRef[] {
  return holdingKeys(portfolioStore.getState().transactions)
    .map(refFor)
    .filter((r): r is InstrumentRef => r !== null);
}

/** Shows cached prices immediately (LLD §3.8 step 0). */
export function hydrateMarket(): void {
  marketStore.getState().hydrate(currentRefs());
}

/** Runs the refresh pipeline for the current holdings (pull to refresh, app open). */
export function refreshPortfolio(force: boolean): Promise<void> {
  const txs = portfolioStore.getState().transactions;
  return marketStore.getState().runRefresh({
    refs: currentRefs(),
    earliestBuy: earliestBuy(txs),
    earliestBuyByMarket: earliestBuyByMarket(txs),
    force,
  });
}

/** True when a held instrument has no snapshot yet (e.g. just added). */
export function hasUnpricedHoldings(): boolean {
  const snaps = marketStore.getState().snapshots;
  return holdingKeys(portfolioStore.getState().transactions).some((k) => !snaps.has(k));
}

/** Inputs of {@link buildPricingContext}. */
export type PricingSources = {
  readonly snapshots: PricingContext['snapshots'];
  readonly fx: FxContext | null;
  readonly sector: SectorSources;
  readonly analysis: ReadonlyMap<InstrumentKey, AnalysisEntry>;
  readonly performance: Readonly<Record<InstrumentKey, { readonly value: { readonly rating: Label } }>>;
};

/** Pricing context (LLD §2.2): Health labels from the analysis store, Performance from the AI cache. */
export function buildPricingContext(src: PricingSources): PricingContext {
  const sectorOf = (key: InstrumentKey): string | null => resolveSector(key, src.sector);
  const labels = new Map<InstrumentKey, { performance: Label | null; health: Label | null }>();
  for (const [key, entry] of src.analysis)
    labels.set(key, { performance: null, health: entry.analysis.healthLabel });
  for (const [key, entry] of Object.entries(src.performance) as [
    InstrumentKey,
    { value: { rating: Label } },
  ][])
    labels.set(key, { performance: entry.value.rating, health: labels.get(key)?.health ?? null });
  return { valuationDate: localIsoDate(), snapshots: src.snapshots, fx: src.fx ?? NO_FX, sectorOf, labels };
}

/** Every holding from the current store state (outside React, e.g. the AI sync). */
export function currentHoldings(): StockHolding[] {
  const m = marketStore.getState();
  const ctx = buildPricingContext({
    snapshots: m.snapshots,
    fx: m.fx,
    sector: {
      overrides: sessionStore.getState().profile?.sectorOverrides,
      profiles: m.profiles,
      index: getInstrumentIndex(),
    },
    analysis: analysisStore.getState().byKey,
    performance: aiStore.getState().performance,
  });
  return aggregateHoldings(portfolioStore.getState().transactions, ctx, { ...NO_FILTERS, sort: 'NAME_ASC' });
}

/** Pricing context from the stores (LLD §4.3 `usePricingContext`). */
export function usePricingContext(): PricingContext {
  const snapshots = useMarket((s) => s.snapshots);
  const fx = useMarket((s) => s.fx);
  const profiles = useMarket((s) => s.profiles);
  const analysis = useAnalysis((s) => s.byKey);
  const performance = useAi((s) => s.performance);
  const overrides = useSession((s) => s.profile?.sectorOverrides);
  const listVersion = useInstruments((s) => s.meta?.version);
  const index = listVersion ? getInstrumentIndex() : null;
  return useMemo(
    () =>
      buildPricingContext({
        snapshots,
        fx,
        sector: { overrides, profiles, index },
        analysis,
        performance,
      }),
    [snapshots, fx, profiles, analysis, performance, overrides, index],
  );
}

/** Every holding, unfiltered (S02b / S02c / filter counts). */
export function useHoldings(): readonly StockHolding[] {
  const transactions = usePortfolio((s) => s.transactions);
  const ctx = usePricingContext();
  return useMemo(
    () => aggregateHoldings(transactions, ctx, { ...NO_FILTERS, sort: 'NAME_ASC' }),
    [transactions, ctx],
  );
}

/** One holding (all brokers, unfiltered); null when the stock has no buys. */
export function useHolding(key: InstrumentKey | null): StockHolding | null {
  const holdings = useHoldings();
  return useMemo(() => holdings.find((h) => h.key === key) ?? null, [holdings, key]);
}

/** The S02 view model (LLD §4.3 `usePortfolioView`). */
export type PortfolioView = {
  readonly holdings: readonly StockHolding[];
  readonly sectors: readonly SectorGroup[];
  readonly summary: PortfolioSummary;
  readonly currency: Currency;
  readonly totalHoldings: number;
};

/** Filtered holdings → sector groups → summary in the summary currency. */
export function usePortfolioView(): PortfolioView {
  const transactions = usePortfolio((s) => s.transactions);
  const filters = useUi((s) => s.portfolioFilters);
  const currency = useSession((s) => s.profile?.settings.summaryCurrency ?? 'INR');
  const ctx = usePricingContext();
  return useMemo(() => {
    const holdings = aggregateHoldings(transactions, ctx, filters);
    return {
      holdings,
      sectors: groupBySector(holdings, ctx.fx, currency),
      summary: summarisePortfolio(holdings, ctx.fx, currency),
      currency,
      totalHoldings: holdingKeys(transactions).length,
    };
  }, [transactions, ctx, filters, currency]);
}
