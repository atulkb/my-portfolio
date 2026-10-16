import { NO_FILTERS, type InstrumentRef } from '@portfolio/core';

import { createKeyValueCache, memoryRawStore } from '@/services/cache/kv';
import type { PricedSnapshot } from '@/services/market-data/marketDataService';
import type { MarketData, RefreshOutput, RefreshService } from '@/services/refresh/refreshService';
import { createAnalysisStore } from './analysisStore';
import { createMarketStore } from './marketStore';
import { createUiStore, hasActiveFilters } from './uiStore';

const snap = (close: number): PricedSnapshot => ({
  key: 'NSE:INFY',
  sessionDate: '2026-10-16',
  close,
  prevClose: close - 1,
  bars: [],
  stale: false,
  provider: 'yahoo',
  priceSource: 'BARS',
  indicatorsAsOf: '2026-10-16',
});
const ref: InstrumentRef = {
  key: 'NSE:INFY',
  symbol: 'INFY',
  exchange: 'NSE',
  bseCode: null,
  type: 'EQUITY',
};
const fx = {
  context: { usdInr: 95, asOf: '2026-10-16', history: [] },
  source: 'ECB' as const,
  fromCache: false,
};
const macro = { indiaVix: 14, vix: 18, nifty: null, sp500: null };
const data = (close: number): MarketData => ({
  snapshots: new Map([['NSE:INFY', snap(close)]]),
  fx,
  fundamentals: new Map(),
  profiles: new Map([['NSE:INFY', { sector: 'Technology', industry: 'IT Services' }]]),
  macro,
  indexHistory: {},
});

describe('marketStore', () => {
  it('hydrates from cache, refreshes once for concurrent calls, and reports progress', async () => {
    let release: (o: RefreshOutput) => void = () => undefined;
    const refresh: RefreshService = {
      cached: () => data(100),
      refresh: jest.fn(
        (input) =>
          new Promise<RefreshOutput>((r) => {
            input.onProgress?.(1, 1);
            release = r;
          }),
      ),
      instrument: jest.fn(),
    };
    const store = createMarketStore({ refresh, now: () => 42 });
    store.getState().hydrate([ref]);
    expect(store.getState().snapshots.get('NSE:INFY')?.close).toBe(100);
    expect(store.getState().fx?.usdInr).toBe(95);
    expect(store.getState().profiles.get('NSE:INFY')?.sector).toBe('Technology');
    expect(store.getState().macro).toEqual(macro);

    const a = store
      .getState()
      .runRefresh({ refs: [ref], earliestBuy: null, earliestBuyByMarket: {}, force: false });
    const b = store
      .getState()
      .runRefresh({ refs: [ref], earliestBuy: null, earliestBuyByMarket: {}, force: false });
    expect(store.getState().refresh.running).toBe(true);
    expect(store.getState().refresh.progress).toEqual({ done: 1, total: 1 });
    release({
      ...data(105),
      report: { fetched: 1, fromCache: 0, stale: [], failed: [], fxFromCache: false, durationMs: 5 },
    });
    await Promise.all([a, b]);
    expect(refresh.refresh).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshots.get('NSE:INFY')?.close).toBe(105);
    expect(store.getState().refresh).toMatchObject({ running: false, lastAt: 42 });

    store.getState().reset();
    expect(store.getState().snapshots.size).toBe(0);
  });

  it('loads one Research instrument: cache first, then the network result', async () => {
    const refresh: RefreshService = {
      cached: () => ({ ...data(100), fundamentals: new Map() }),
      refresh: jest.fn(),
      instrument: jest.fn(async () => ({
        snapshot: snap(110),
        fundamentals: null,
        profile: { sector: 'Technology', industry: null },
        failure: null,
      })),
    };
    const store = createMarketStore({ refresh, now: () => 1 });
    const p = store.getState().loadInstrument(ref);
    expect(store.getState().snapshots.get('NSE:INFY')?.close).toBe(100);
    expect(store.getState().instrumentLoads.get('NSE:INFY')?.state).toBe('loading');
    await p;
    expect(store.getState().snapshots.get('NSE:INFY')?.close).toBe(110);
    expect(store.getState().fundamentals.has('NSE:INFY')).toBe(true);
    expect(store.getState().instrumentLoads.get('NSE:INFY')).toEqual({ state: 'ready', failure: null });
  });
});

describe('analysisStore', () => {
  const bars = Array.from({ length: 260 }, (_, i) => {
    const c = 100 + i * 0.5;
    return {
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      open: c,
      high: c + 1,
      low: c - 1,
      close: c,
      adjClose: c,
      volume: 1000,
    };
  });

  it('computes Health, marks missing fundamentals as insufficient, and memoises', () => {
    const store = createAnalysisStore();
    const row = {
      key: 'NSE:INFY' as const,
      bars,
      fundamentals: undefined,
      sectorCategory: 'TECH' as const,
      market: 'IN' as const,
    };
    store.getState().recompute([row], macro);
    const first = store.getState().byKey.get('NSE:INFY');
    expect(first?.indicators.sma200).not.toBeNull();
    // Technicals alone are fewer than half of the applicable parameters → ⚪.
    expect(first?.analysis.healthLabel).toBeNull();
    expect(first?.analysis.params.some((p) => p.group === 'FUNDAMENTAL' && p.level === 'NA')).toBe(true);

    store.getState().recompute([row], macro);
    expect(store.getState().byKey.get('NSE:INFY')).toBe(first);

    store.getState().recompute(
      [
        {
          ...row,
          fundamentals: {
            pe: 18,
            pb: 2,
            peg: 0.9,
            roePct: 22,
            roce: null,
            de: 0.2,
            currentRatio: 2,
            interestCoverage: null,
            revenueGrowthPct: 16,
            epsGrowthPct: 18,
            netMarginPct: 20,
            fcf: { ttm: 1e9, trend: null },
            dividendYieldPct: 1,
            promoterHoldingPct: null,
            pledgePct: null,
            growthBasis: 'YOY',
            asOf: '2026-10-16',
            provider: 'yahoo',
          },
        },
      ],
      macro,
    );
    const second = store.getState().byKey.get('NSE:INFY');
    expect(second?.indicators).toBe(first?.indicators);
    expect(second?.analysis.healthLabel).toBe('GOOD');
    store.getState().reset();
    expect(store.getState().byKey.size).toBe(0);
  });
});

describe('uiStore', () => {
  it('persists filters and collapsed sectors', () => {
    const kv = createKeyValueCache(memoryRawStore());
    const ui = createUiStore(kv);
    ui.getState().setPortfolioFilters({ ...NO_FILTERS, markets: ['US'], sort: 'PNL_PCT_DESC' });
    ui.getState().toggleSector('Energy');
    const again = createUiStore(kv);
    expect(again.getState().portfolioFilters.markets).toEqual(['US']);
    expect(again.getState().collapsedSectors).toEqual(['Energy']);
    expect(hasActiveFilters(again.getState().portfolioFilters)).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, sort: 'NAME_ASC' })).toBe(false);
    again.getState().toggleSector('Energy');
    expect(again.getState().collapsedSectors).toEqual([]);
  });

  it('keeps the recently viewed Research list, most recent first, de-duplicated', () => {
    const kv = createKeyValueCache(memoryRawStore());
    const ui = createUiStore(kv);
    ui.getState().addRecentResearch('NSE:INFY');
    ui.getState().addRecentResearch('NASDAQ:AAPL');
    ui.getState().addRecentResearch('NSE:INFY');
    expect(createUiStore(kv).getState().recentResearch).toEqual(['NSE:INFY', 'NASDAQ:AAPL']);
  });
});
