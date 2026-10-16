import type { BarsResult, InstrumentRef, MarketDataProvider } from '@portfolio/core';
import { z } from 'zod';

import { createKeyValueCache, memoryRawStore } from '../cache/kv';
import { ServiceError, toMarketErrorCode } from '../http/errors';
import { createHttpClient, redactUrl, type HttpDeps } from '../http/httpClient';
import aapl from './__fixtures__/yahoo-chart-aapl.json';
import notFound from './__fixtures__/yahoo-chart-not-found.json';
import reliance from './__fixtures__/yahoo-chart-reliance-ns.json';
import { barsKey, CachedBarsSchema } from './cache';
import { createMarketDataService, STALE_RETRY_MS } from './marketDataService';
import { yahooSymbol } from './symbols';
import { localDate, parseYahooChart, YahooChartSchema } from './yahoo/chart';

type FakeResponse = { status: number; body?: string };

function fakeHttp(responses: (FakeResponse | Error)[]) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  let t = 0;
  const deps: HttpDeps = {
    fetch: async (url) => {
      calls.push(url);
      const r = responses.shift() ?? { status: 500 };
      if (r instanceof Error) throw r;
      return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.body ?? '{}' };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
    random: () => 0,
  };
  return { deps, calls, sleeps };
}

describe('httpClient', () => {
  it('retries network errors and 5xx, then succeeds', async () => {
    const { deps, calls, sleeps } = fakeHttp([
      new Error('offline'),
      { status: 503 },
      { status: 200, body: '{"a":1}' },
    ]);
    const http = createHttpClient(deps, { 'x.test': { concurrency: 2, minIntervalMs: 0 } });
    await expect(
      http.getJson('https://x.test/a', z.object({ a: z.number() }), { provider: 't' }),
    ).resolves.toEqual({ a: 1 });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1500]);
  });

  it('does not retry 404, 401 or 429', async () => {
    for (const [status, code] of [
      [404, 'NOT_FOUND'],
      [401, 'AUTH'],
      [429, 'RATE_LIMITED'],
    ] as const) {
      const { deps, calls } = fakeHttp([{ status }]);
      const http = createHttpClient(deps, {});
      await expect(http.getText('https://x.test/a', { provider: 't' })).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(1);
    }
  });

  it('rejects invalid JSON shapes as BAD_RESPONSE', async () => {
    const { deps } = fakeHttp([{ status: 200, body: '{"a":"x"}' }]);
    const http = createHttpClient(deps, {});
    await expect(
      http.getJson('https://x.test/a', z.object({ a: z.number() }), { provider: 't' }),
    ).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('opens the breaker after 3 failures until reset', async () => {
    const { deps, calls } = fakeHttp([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 200 }]);
    const http = createHttpClient(deps, {});
    await expect(http.getText('https://x.test/a', { provider: 't' })).rejects.toMatchObject({
      code: 'PROVIDER_DOWN',
    });
    await expect(http.getText('https://x.test/b', { provider: 't' })).rejects.toMatchObject({
      code: 'PROVIDER_DOWN',
    });
    expect(calls).toHaveLength(3);
    http.resetBreakers();
    await expect(http.getText('https://x.test/c', { provider: 't' })).resolves.toBe('{}');
  });

  it('paces requests per host', async () => {
    const { deps, sleeps } = fakeHttp([{ status: 200 }, { status: 200 }]);
    const http = createHttpClient(deps, { 'x.test': { concurrency: 1, minIntervalMs: 200 } });
    await http.getText('https://x.test/a', { provider: 't' });
    await http.getText('https://x.test/b', { provider: 't' });
    expect(sleeps).toContain(200);
  });

  it('redacts secrets in logged URLs', () => {
    expect(redactUrl('https://a/b?symbol=X&apikey=SECRET&crumb=abc')).toBe(
      'https://a/b?symbol=X&apikey=***&crumb=***',
    );
  });
});

describe('yahoo', () => {
  it('builds provider symbols (BSE by ticker, US class shares with -)', () => {
    const ref = (symbol: string, exchange: InstrumentRef['exchange']): InstrumentRef => ({
      key: `${exchange}:${symbol}` as InstrumentRef['key'],
      symbol,
      exchange,
      bseCode: '500325',
      type: 'EQUITY',
    });
    expect(yahooSymbol(ref('RELIANCE', 'NSE'))).toBe('RELIANCE.NS');
    expect(yahooSymbol(ref('RELIANCE', 'BSE'))).toBe('RELIANCE.BO');
    expect(yahooSymbol(ref('BRK.B', 'NYSE'))).toBe('BRK-B');
    expect(
      yahooSymbol({ key: 'INDEX:NIFTY50', symbol: 'NIFTY50', exchange: null, bseCode: null, type: 'INDEX' }),
    ).toBe('^NSEI');
  });

  it('converts timestamps to exchange-local dates', () => {
    // 09:15 IST on 16 Oct 2026 = 03:45 UTC.
    expect(localDate(Date.UTC(2026, 9, 16, 3, 45) / 1000, 'Asia/Kolkata')).toBe('2026-10-16');
    // 09:30 ET = 13:30 UTC.
    expect(localDate(Date.UTC(2026, 9, 16, 13, 30) / 1000, 'America/New_York')).toBe('2026-10-16');
  });

  it('parses a recorded chart and drops the in-progress session', () => {
    const chart = YahooChartSchema.parse(aapl);
    const r = parseYahooChart(chart, { lastCompletedSession: '2026-10-15', expectedCurrency: 'USD' });
    expect(r.bars.map((b) => b.date)).toEqual([
      '2026-10-09',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
    expect(r.bars.at(-1)?.close).toBeCloseTo(342, 2);
    expect(r.adjusted).toBe(true);
    expect(r.currency).toBe('USD');
  });

  it('guards the currency and reports unknown symbols', () => {
    const chart = YahooChartSchema.parse(reliance);
    expect(() =>
      parseYahooChart(chart, { lastCompletedSession: '2026-10-16', expectedCurrency: 'USD' }),
    ).toThrow(expect.objectContaining({ code: 'CURRENCY_MISMATCH' }));
    const nf = YahooChartSchema.parse(notFound);
    expect(() =>
      parseYahooChart(nf, { lastCompletedSession: '2026-10-16', expectedCurrency: 'INR' }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('drops rows with missing prices and keeps the last duplicate date', () => {
    const chart = YahooChartSchema.parse({
      chart: {
        error: null,
        result: [
          {
            meta: { currency: 'INR', exchangeTimezoneName: 'Asia/Kolkata' },
            timestamp: [1792122300, 1792122400, 1792208700],
            indicators: {
              quote: [
                {
                  open: [1, 2, null],
                  high: [1, 2, 3],
                  low: [1, 2, 3],
                  close: [10, 11, 12],
                  volume: [5, null, 7],
                },
              ],
            },
          },
        ],
      },
    });
    const r = parseYahooChart(chart, { lastCompletedSession: '2026-12-31', expectedCurrency: 'INR' });
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]).toMatchObject({ close: 11, adjClose: 11, volume: 0 });
    expect(r.adjusted).toBe(false);
  });

  it('maps service errors to the app catalogue', () => {
    expect(toMarketErrorCode(new ServiceError('NOT_FOUND', 'yahoo'))).toBe('MD_NOT_FOUND');
    expect(toMarketErrorCode(new Error('x'))).toBe('MD_NETWORK');
  });
});

describe('marketDataService', () => {
  const ref: InstrumentRef = {
    key: 'NSE:RELIANCE',
    symbol: 'RELIANCE',
    exchange: 'NSE',
    bseCode: null,
    type: 'EQUITY',
  };
  // Fri 16 Oct 2026 18:00 IST: the 16 Oct session has closed.
  const EVENING = Date.UTC(2026, 9, 16, 12, 30);

  function result(dates: string[]): BarsResult {
    return {
      bars: dates.map((date, i) => ({
        date,
        open: 100,
        high: 110,
        low: 90,
        close: 100 + i,
        adjClose: 100 + i,
        volume: 1,
      })),
      currency: 'INR',
      adjusted: true,
      provider: 'yahoo',
    };
  }

  function setup(answers: (BarsResult | Error)[], now = EVENING) {
    const calls: string[] = [];
    const provider: MarketDataProvider = {
      id: 'yahoo',
      supports: () => true,
      getDailyBars: async (req) => {
        calls.push(String(req.ref.key));
        const a = answers.shift();
        if (!a || a instanceof Error) throw a ?? new ServiceError('PROVIDER_DOWN', 'yahoo');
        return a;
      },
    };
    let t = now;
    const kv = createKeyValueCache(memoryRawStore());
    const svc = createMarketDataService({ providers: [provider], kv, clock: { now: () => t } });
    return { svc, kv, calls, setNow: (n: number) => (t = n) };
  }

  it('fetches, caches and builds a snapshot with prevClose', async () => {
    const { svc, kv } = setup([result(['2026-10-15', '2026-10-16'])]);
    const r = await svc.getSnapshots([ref], { force: false });
    const s = r.snapshots.get('NSE:RELIANCE');
    expect(s).toMatchObject({ sessionDate: '2026-10-16', close: 101, prevClose: 100, stale: false });
    expect(r.fetched).toBe(1);
    expect(kv.get(barsKey('NSE:RELIANCE'), CachedBarsSchema)?.d).toHaveLength(2);
  });

  it('serves a current cache without calling the provider', async () => {
    const { svc, calls } = setup([result(['2026-10-16'])]);
    await svc.getSnapshots([ref], { force: false });
    const r = await svc.getSnapshots([ref], { force: false });
    expect(calls).toHaveLength(1);
    expect(r.fetched).toBe(0);
    expect(svc.cachedSnapshots([ref]).get('NSE:RELIANCE')?.close).toBe(100);
  });

  it('keeps a stale cache when the provider fails, and marks it stale', async () => {
    const { svc, setNow } = setup([result(['2026-10-15']), new ServiceError('PROVIDER_DOWN', 'yahoo')]);
    await svc.getSnapshots([ref], { force: false });
    setNow(EVENING + STALE_RETRY_MS + 1);
    const r = await svc.getSnapshots([ref], { force: false });
    expect(r.snapshots.get('NSE:RELIANCE')?.stale).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it('reports a failure only when nothing is cached', async () => {
    const { svc } = setup([new ServiceError('NOT_FOUND', 'yahoo')]);
    const r = await svc.getSnapshots([ref], { force: false });
    expect(r.failures).toEqual([{ key: 'NSE:RELIANCE', code: 'MD_NOT_FOUND' }]);
  });

  it('does not re-ask within 30 min for a session the provider lacks (holiday)', async () => {
    const { svc, calls } = setup([result(['2026-10-15']), result(['2026-10-15'])]);
    await svc.getSnapshots([ref], { force: false });
    await svc.getSnapshots([ref], { force: false });
    expect(calls).toHaveLength(1);
  });
});
