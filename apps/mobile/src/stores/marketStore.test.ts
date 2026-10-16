import { NO_FILTERS, type InstrumentRef } from '@portfolio/core';

import { createKeyValueCache, memoryRawStore } from '@/services/cache/kv';
import type { PricedSnapshot } from '@/services/market-data/marketDataService';
import type { RefreshOutput, RefreshService } from '@/services/refresh/refreshService';
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

describe('marketStore', () => {
  it('hydrates from cache, refreshes once for concurrent calls, and reports progress', async () => {
    let release: (o: RefreshOutput) => void = () => undefined;
    const refresh: RefreshService = {
      cached: () => ({ snapshots: new Map([['NSE:INFY', snap(100)]]), fx }),
      refresh: jest.fn(
        (input) =>
          new Promise<RefreshOutput>((r) => {
            input.onProgress?.(1, 1);
            release = r;
          }),
      ),
    };
    const store = createMarketStore({ refresh, now: () => 42 });
    store.getState().hydrate([ref]);
    expect(store.getState().snapshots.get('NSE:INFY')?.close).toBe(100);
    expect(store.getState().fx?.usdInr).toBe(95);

    const a = store.getState().runRefresh({ refs: [ref], earliestBuy: null, force: false });
    const b = store.getState().runRefresh({ refs: [ref], earliestBuy: null, force: false });
    expect(store.getState().refresh.running).toBe(true);
    expect(store.getState().refresh.progress).toEqual({ done: 1, total: 1 });
    release({
      snapshots: new Map([['NSE:INFY', snap(105)]]),
      fx,
      report: { fetched: 1, fromCache: 0, stale: [], failed: [], fxFromCache: false, durationMs: 5 },
    });
    await Promise.all([a, b]);
    expect(refresh.refresh).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshots.get('NSE:INFY')?.close).toBe(105);
    expect(store.getState().refresh).toMatchObject({ running: false, lastAt: 42 });

    store.getState().reset();
    expect(store.getState().snapshots.size).toBe(0);
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
});
