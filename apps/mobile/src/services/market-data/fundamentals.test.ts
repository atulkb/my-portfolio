import type { BarsResult, Fundamentals, InstrumentRef, MarketDataProvider } from '@portfolio/core';
import type { z } from 'zod';

import { createKeyValueCache, memoryRawStore } from '../cache/kv';
import { ServiceError } from '../http/errors';
import type { HttpClient } from '../http/httpClient';
import { createRefreshService, macroFrom } from '../refresh/refreshService';
import aaplQs from './__fixtures__/yahoo-qs-aapl.json';
import hdfcQs from './__fixtures__/yahoo-qs-hdfcbank-ns.json';
import etfQs from './__fixtures__/yahoo-qs-niftybees-ns.json';
import notFoundQs from './__fixtures__/yahoo-qs-not-found.json';
import relianceQs from './__fixtures__/yahoo-qs-reliance-ns.json';
import { CachedIndexHistorySchema, fundamentalsKey, indexHistoryKey, toCachedBars, barsKey } from './cache';
import { createMarketDataService, FUNDAMENTALS_TTL_MS, PROFILE_TTL_MS } from './marketDataService';
import { parseFundamentals, parseProfile, YahooQuoteSummarySchema } from './yahoo/quoteSummary';
import { createYahooProvider } from './yahoo/yahooProvider';
import { createYahooSession, CRUMB_RETRY_MS } from './yahoo/session';

const ref = (symbol: string, exchange: InstrumentRef['exchange'], type: InstrumentRef['type'] = 'EQUITY') =>
  ({ key: `${exchange}:${symbol}`, symbol, exchange, bseCode: null, type }) as InstrumentRef;

describe('yahoo quoteSummary', () => {
  it('maps fundamentals with unit conversions (LLD §3.3)', () => {
    const f = parseFundamentals(YahooQuoteSummarySchema.parse(aaplQs), '2026-10-16');
    expect(f.pe).toBeCloseTo(39.297, 3);
    expect(f.pb).toBeCloseTo(46.558, 3);
    expect(f.peg).toBe(2.75);
    expect(f.roePct).toBeCloseTo(148.751, 3);
    expect(f.de).toBeCloseTo(0.78445, 5);
    expect(f.currentRatio).toBe(1.003);
    expect(f.revenueGrowthPct).toBeCloseTo(16.4, 6);
    expect(f.epsGrowthPct).toBeCloseTo(28.7, 6);
    expect(f.netMarginPct).toBeCloseTo(27.619, 3);
    expect(f.fcf).toEqual({ ttm: 107721875456, trend: null });
    expect(f.dividendYieldPct).toBeCloseTo(0.32, 6);
    expect(f).toMatchObject({
      roce: null,
      interestCoverage: null,
      promoterHoldingPct: null,
      growthBasis: 'YOY',
    });
    expect(parseProfile(YahooQuoteSummarySchema.parse(aaplQs))).toEqual({
      sector: 'Technology',
      industry: 'Consumer Electronics',
    });
  });

  it('keeps missing fields null (never 0)', () => {
    const r = parseFundamentals(YahooQuoteSummarySchema.parse(relianceQs), '2026-10-16');
    expect(r.roePct).toBeNull();
    expect(r.currentRatio).toBeNull();
    expect(r.fcf).toBeNull();
    const h = parseFundamentals(YahooQuoteSummarySchema.parse(hdfcQs), '2026-10-16');
    expect(h.de).toBeNull();
    expect(parseProfile(YahooQuoteSummarySchema.parse(hdfcQs)).sector).toBe('Financial Services');
    const etf = YahooQuoteSummarySchema.parse(etfQs);
    expect(parseProfile(etf)).toEqual({ sector: null, industry: null });
    expect(parseFundamentals(etf, '2026-10-16').growthBasis).toBeNull();
  });

  it('reports unknown symbols as NOT_FOUND', () => {
    expect(() => parseProfile(YahooQuoteSummarySchema.parse(notFoundQs))).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});

function fakeHttp(route: (url: string) => unknown) {
  const urls: string[] = [];
  const respond = (url: string): unknown => {
    urls.push(url);
    const body = route(url);
    if (body instanceof Error) throw body;
    return body;
  };
  const http: HttpClient = {
    getText: async (url) => String(respond(url)),
    getJson: async <T>(url: string, schema: z.ZodType<T>) => schema.parse(respond(url)),
    resetBreakers: () => undefined,
  };
  return { http, urls };
}

describe('yahoo session + provider', () => {
  it('gets a crumb once (fc.yahoo.com 404 is expected) and reuses one quoteSummary for both calls', async () => {
    const { http, urls } = fakeHttp((url) => {
      if (url.startsWith('https://fc.yahoo.com')) return new ServiceError('NOT_FOUND', 'yahoo');
      if (url.includes('getcrumb')) return 'abcDEF123.x';
      return aaplQs;
    });
    const yahoo = createYahooProvider(http, { now: () => 0 });
    const aapl = ref('AAPL', 'NASDAQ');
    await expect(yahoo.getFundamentals?.(aapl)).resolves.toMatchObject({ peg: 2.75 });
    await expect(yahoo.getProfile?.(aapl)).resolves.toMatchObject({ sector: 'Technology' });
    expect(urls.filter((u) => u.includes('quoteSummary'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('getcrumb'))).toHaveLength(1);
    expect(urls.at(-1)).toContain('crumb=abcDEF123.x');
  });

  it('refreshes the crumb once on 401', async () => {
    let calls = 0;
    const { http, urls } = fakeHttp((url) => {
      if (url.startsWith('https://fc.yahoo.com')) return '';
      if (url.includes('getcrumb')) return 'crumb000001';
      calls += 1;
      return calls === 1 ? new ServiceError('AUTH', 'yahoo', { status: 401 }) : relianceQs;
    });
    const yahoo = createYahooProvider(http, { now: () => 0 });
    await expect(yahoo.getProfile?.(ref('RELIANCE', 'NSE'))).resolves.toMatchObject({ sector: 'Energy' });
    expect(urls.filter((u) => u.includes('getcrumb'))).toHaveLength(2);
  });

  it('backs off after a failed crumb instead of retrying per instrument', async () => {
    let t = 0;
    const { http, urls } = fakeHttp((url) =>
      url.includes('getcrumb') ? new ServiceError('RATE_LIMITED', 'yahoo') : '',
    );
    const session = createYahooSession(http, 'https://q', () => t);
    await expect(session.crumb()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(session.crumb()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(urls.filter((u) => u.includes('getcrumb'))).toHaveLength(1);
    t = CRUMB_RETRY_MS + 1;
    await expect(session.crumb()).rejects.toBeDefined();
    expect(urls.filter((u) => u.includes('getcrumb'))).toHaveLength(2);
  });

  it('rejects a non-crumb body (e.g. an error page) as AUTH', async () => {
    const { http } = fakeHttp((url) => (url.includes('getcrumb') ? 'Too Many Requests' : ''));
    await expect(createYahooSession(http, 'https://q', () => 0).crumb()).rejects.toMatchObject({
      code: 'AUTH',
    });
  });
});

const F: Fundamentals = parseFundamentals(YahooQuoteSummarySchema.parse(aaplQs), '2026-10-16');

function setup(opts: { fundamentals?: () => Promise<Fundamentals>; bars?: (from: string) => BarsResult }) {
  let t = Date.UTC(2026, 9, 16, 12, 30);
  const calls = { fundamentals: 0, profile: 0, bars: [] as string[] };
  const provider: MarketDataProvider = {
    id: 'yahoo',
    supports: () => true,
    getFundamentals: async () => {
      calls.fundamentals += 1;
      return opts.fundamentals ? opts.fundamentals() : F;
    },
    getProfile: async () => {
      calls.profile += 1;
      return { sector: 'Technology', industry: null };
    },
    getDailyBars: async (req) => {
      const from = req.range.kind === 'from' ? req.range.from : '1y';
      calls.bars.push(from);
      if (!opts.bars) throw new ServiceError('PROVIDER_DOWN', 'yahoo');
      return opts.bars(from);
    },
  };
  const kv = createKeyValueCache(memoryRawStore());
  const svc = createMarketDataService({ providers: [provider], kv, clock: { now: () => t } });
  return { svc, kv, calls, advance: (ms: number) => (t += ms) };
}

const bars = (dates: string[], start = 100): BarsResult => ({
  bars: dates.map((date, i) => ({
    date,
    open: start + i,
    high: start + i,
    low: start + i,
    close: start + i,
    adjClose: start + i,
    volume: 1,
  })),
  currency: null,
  adjusted: true,
  provider: 'yahoo',
});

describe('fundamentals + profiles', () => {
  const aapl = ref('AAPL', 'NASDAQ');

  it('caches fundamentals for 7 days and profiles for 30', async () => {
    const { svc, calls, advance } = setup({});
    await svc.getFundamentals([aapl]);
    await svc.getProfiles([aapl]);
    await svc.getFundamentals([aapl]);
    expect(calls).toMatchObject({ fundamentals: 1, profile: 1 });
    advance(FUNDAMENTALS_TTL_MS + 1);
    await svc.getFundamentals([aapl]);
    await svc.getProfiles([aapl]);
    expect(calls).toMatchObject({ fundamentals: 2, profile: 1 });
    advance(PROFILE_TTL_MS);
    await svc.getProfiles([aapl]);
    expect(calls.profile).toBe(2);
    expect(svc.cachedFundamentals([aapl]).get('NASDAQ:AAPL')?.peg).toBe(2.75);
  });

  it('caches "no data" for unknown symbols but not for network failures', async () => {
    let error = new ServiceError('NETWORK', 'yahoo');
    const { svc, kv, calls, advance } = setup({ fundamentals: async () => Promise.reject(error) });
    const r = await svc.getFundamentals([aapl]);
    expect(r.has('NASDAQ:AAPL')).toBe(false);
    expect(kv.keys('market.fundamentals.')).toHaveLength(0);
    error = new ServiceError('NOT_FOUND', 'yahoo');
    advance(1);
    const r2 = await svc.getFundamentals([aapl]);
    expect(r2.get('NASDAQ:AAPL')).toBeNull();
    expect(kv.keys(fundamentalsKey(''))).toHaveLength(1);
    await svc.getFundamentals([aapl]);
    expect(calls.fundamentals).toBe(2);
  });

  it('keeps stale fundamentals when a refetch fails', async () => {
    let fail = false;
    const { svc, advance } = setup({
      fundamentals: async () => (fail ? Promise.reject(new ServiceError('TIMEOUT', 'yahoo')) : F),
    });
    await svc.getFundamentals([aapl]);
    fail = true;
    advance(FUNDAMENTALS_TTL_MS + 1);
    expect((await svc.getFundamentals([aapl])).get('NASDAQ:AAPL')?.pe).toBe(F.pe);
  });

  it('gives ETFs sector "ETF" and no fundamentals without a network call', async () => {
    const { svc, calls } = setup({});
    const etf = ref('NIFTYBEES', 'NSE', 'ETF');
    expect((await svc.getProfiles([etf])).get('NSE:NIFTYBEES')).toEqual({ sector: 'ETF', industry: null });
    expect((await svc.getFundamentals([etf])).has('NSE:NIFTYBEES')).toBe(false);
    expect(calls).toMatchObject({ fundamentals: 0, profile: 0 });
  });
});

describe('benchmark index history', () => {
  it('fetches from the earliest buy minus a week, then extends from the daily index bars', async () => {
    const { svc, kv, calls } = setup({ bars: () => bars(['2024-01-02', '2024-01-03', '2026-10-15']) });
    const h1 = await svc.getIndexHistory('NIFTY50', '2024-01-10');
    expect(calls.bars).toEqual(['2024-01-03']);
    expect(h1.map((b) => b.date)).toEqual(['2024-01-02', '2024-01-03', '2026-10-15']);

    // The daily refresh caches the latest index bars; the history grows from them, no fetch.
    const recent = toCachedBars('INDEX:NIFTY50', bars(['2026-10-14', '2026-10-15', '2026-10-16'], 200), 0);
    kv.set(barsKey('INDEX:NIFTY50'), recent);
    const h2 = await svc.getIndexHistory('NIFTY50', '2024-01-10');
    expect(calls.bars).toHaveLength(1);
    expect(h2.at(-1)).toMatchObject({ date: '2026-10-16', adjClose: 202 });
    expect(kv.get(indexHistoryKey('NIFTY50'), CachedIndexHistorySchema)?.d).toHaveLength(4);
    expect(svc.cachedIndexHistory('NIFTY50')).toHaveLength(4);

    // An older buy refetches from the new start.
    await svc.getIndexHistory('NIFTY50', '2022-05-10');
    expect(calls.bars.at(-1)).toBe('2022-05-03');
  });
});

describe('refresh pipeline (M6 steps)', () => {
  it('publishes prices first, then fundamentals, profiles, macro and benchmark', async () => {
    const { svc } = setup({
      bars: (from) => bars(from === '1y' ? ['2026-10-15', '2026-10-16'] : ['2026-01-02', '2026-10-15']),
    });
    const { http } = fakeHttp(() => ({ date: '2026-10-16', rates: { INR: 95 } }));
    const fx = { get: jest.fn(async () => null), cached: () => null };
    const refresh = createRefreshService({ http, market: svc, fx, now: () => 0 });
    const order: string[] = [];
    const out = await refresh.refresh({
      refs: [ref('AAPL', 'NASDAQ')],
      earliestBuy: '2026-01-05',
      earliestBuyByMarket: { US: '2026-01-05' },
      force: false,
      onPrices: (p) => order.push(`prices:${p.snapshots.size}`),
    });
    expect(order).toEqual(['prices:1']);
    expect(out.fundamentals.get('NASDAQ:AAPL')?.peg).toBe(2.75);
    expect(out.profiles.get('NASDAQ:AAPL')?.sector).toBe('Technology');
    expect(out.macro.vix).toBe(101);
    expect(out.indexHistory.SP500?.at(-1)?.date).toBe('2026-10-16');
    expect(out.indexHistory.NIFTY50).toBeUndefined();
  });

  it('derives macro (VIX levels, index vs SMA-200)', () => {
    expect(macroFrom(new Map())).toEqual({ indiaVix: null, vix: null, nifty: null, sp500: null });
  });
});
