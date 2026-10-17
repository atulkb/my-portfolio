import { readFileSync } from 'fs';
import { join } from 'path';

import type { BarsResult, InstrumentRef, MarketDataProvider } from '@portfolio/core';

import { createKeyValueCache, memoryRawStore } from '../cache/kv';
import { ServiceError } from '../http/errors';
import type { HttpClient } from '../http/httpClient';
import { createFinnhubProvider, parseFinnhubMetric } from './finnhub/finnhubProvider';
import { createMarketDataService } from './marketDataService';
import { parseQuotePage } from './quotepage/parse';
import { quotePageSymbol, twelveDataSymbol } from './symbols';
import {
  createTwelveDataProvider,
  parseTwelveDataSeries,
  TWELVE_DATA_PER_MINUTE,
} from './twelvedata/twelveDataProvider';

const fixture = (name: string): string => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const ref = (over: Partial<InstrumentRef> = {}): InstrumentRef => ({
  key: 'NSE:RELIANCE',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  bseCode: null,
  type: 'EQUITY',
  ...over,
});

describe('quote page (recorded Google Finance pages, 2026-10-17)', () => {
  it('reads the close, session date and currency', () => {
    expect(parseQuotePage(fixture('gfinance-aapl.html'), 'USD', '2026-10-16')).toEqual({
      close: 343.46,
      sessionDate: '2026-10-16',
      currency: 'USD',
    });
    expect(parseQuotePage(fixture('gfinance-reliance-nse.html'), 'INR', '2026-10-16')).toEqual({
      close: 1211.2,
      sessionDate: '2026-10-16',
      currency: 'INR',
    });
    expect(parseQuotePage(fixture('gfinance-500325-bom.html'), 'INR', '2026-10-17').close).toBe(1210);
  });

  it('puts a month later than today in the previous year', () => {
    expect(parseQuotePage(fixture('gfinance-aapl.html'), 'USD', '2027-01-05').sessionDate).toBe('2026-10-16');
  });

  it('fails loudly on a changed page or the wrong currency', () => {
    expect(() => parseQuotePage('<html>nothing here</html>', 'USD', '2026-10-16')).toThrow(
      expect.objectContaining({ code: 'BAD_RESPONSE' }),
    );
    expect(() => parseQuotePage(fixture('gfinance-aapl.html'), 'INR', '2026-10-16')).toThrow(
      expect.objectContaining({ code: 'CURRENCY_MISMATCH' }),
    );
  });

  it('builds quote-page symbols (BSE needs the scrip code)', () => {
    expect(quotePageSymbol(ref())).toBe('RELIANCE:NSE');
    expect(quotePageSymbol(ref({ exchange: 'BSE', bseCode: '500325' }))).toBe('500325:BOM');
    expect(quotePageSymbol(ref({ exchange: 'BSE' }))).toBeNull();
    expect(quotePageSymbol(ref({ symbol: 'BRK.B', exchange: 'NYSE' }))).toBe('BRK.B:NYSE');
    expect(quotePageSymbol(ref({ symbol: 'SPY', exchange: 'NYSE_ARCA' }))).toBe('SPY:NYSEARCA');
    expect(twelveDataSymbol(ref({ symbol: 'AAPL', exchange: 'NASDAQ' }))).toEqual({
      symbol: 'AAPL',
      exchange: 'NASDAQ',
    });
  });
});

/** Shapes follow the providers' documentation; replace with recorded answers once keys exist. */
describe('Twelve Data (documented response shape)', () => {
  const ok = {
    status: 'ok' as const,
    meta: { currency: 'USD' },
    values: [
      { datetime: '2026-10-19', open: 1, high: 1, low: 1, close: 1 },
      { datetime: '2026-10-16', open: 340, high: 345, low: 338, close: 343.46, volume: 1000 },
      { datetime: '2026-10-15', open: 335, high: 342, low: 334, close: 342, volume: 900 },
    ],
  };

  it('returns oldest-first unadjusted bars without the in-progress session', () => {
    const r = parseTwelveDataSeries(ok, { lastCompletedSession: '2026-10-16', expectedCurrency: 'USD' });
    expect(r.bars.map((b) => b.date)).toEqual(['2026-10-15', '2026-10-16']);
    expect(r).toMatchObject({ adjusted: false, provider: 'twelvedata' });
    expect(r.bars[1]?.adjClose).toBe(343.46);
  });

  it('maps API errors and guards the currency', () => {
    const err = (code: number) =>
      parseTwelveDataSeries(
        { status: 'error', code },
        { lastCompletedSession: '2026-10-16', expectedCurrency: 'USD' },
      );
    expect(() => err(404)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => err(429)).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }));
    expect(() => err(401)).toThrow(expect.objectContaining({ code: 'AUTH' }));
    expect(() =>
      parseTwelveDataSeries(ok, { lastCompletedSession: '2026-10-16', expectedCurrency: 'INR' }),
    ).toThrow(expect.objectContaining({ code: 'CURRENCY_MISMATCH' }));
  });

  it('is off without a key, US-only unless India is enabled, and stays within 8 calls a minute', async () => {
    const http = { getJson: jest.fn(async () => ok) } as unknown as HttpClient;
    const clock = { now: () => Date.UTC(2026, 9, 16, 22, 0) };
    expect(
      createTwelveDataProvider(http, clock, { apiKey: '', india: true }).supports('BARS', 'NASDAQ'),
    ).toBe(false);
    const p = createTwelveDataProvider(http, clock, { apiKey: 'k', india: false });
    expect(p.supports('BARS', 'NASDAQ')).toBe(true);
    expect(p.supports('BARS', 'NSE')).toBe(false);
    const aapl = ref({ key: 'NASDAQ:AAPL', symbol: 'AAPL', exchange: 'NASDAQ' });
    for (let i = 0; i < TWELVE_DATA_PER_MINUTE; i++)
      await p.getDailyBars?.({ ref: aapl, range: { kind: '1y' } });
    await expect(p.getDailyBars?.({ ref: aapl, range: { kind: '1y' } })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('Finnhub (documented response shape)', () => {
  it('maps metrics, preferring 3-year CAGR growth', () => {
    const f = parseFinnhubMetric(
      {
        metric: {
          peTTM: 30,
          pb: 45,
          roeTTM: 150,
          'totalDebt/totalEquityQuarterly': 1.5,
          currentRatioQuarterly: 0.9,
          revenueGrowth3Y: 8,
          epsGrowth3Y: 10,
          revenueGrowthTTMYoy: 2,
          netProfitMarginTTM: 24,
          dividendYieldIndicatedAnnual: 0.4,
        },
      },
      '2026-10-16',
    );
    expect(f).toMatchObject({ pe: 30, roePct: 150, de: 1.5, revenueGrowthPct: 8, growthBasis: 'CAGR3Y' });
    expect(f.peg).toBeCloseTo(3, 5);
    expect(f.provider).toBe('finnhub');
  });

  it('treats an empty answer as not found and supports US equities only', () => {
    expect(() => parseFinnhubMetric({ metric: {} }, '2026-10-16')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    const p = createFinnhubProvider({} as HttpClient, { now: () => 0 }, 'k');
    expect(p.supports('FUNDAMENTALS', 'NASDAQ')).toBe(true);
    expect(p.supports('FUNDAMENTALS', 'NSE')).toBe(false);
    expect(p.supports('BARS', 'NASDAQ')).toBe(false);
    expect(createFinnhubProvider({} as HttpClient, { now: () => 0 }, '').supports('PROFILE', 'NYSE')).toBe(
      false,
    );
  });
});

describe('scrape fallback in the market-data service', () => {
  // Fri 16 Oct 2026 18:00 IST: closed. Mon 19 Oct 10:00 IST: open, expected session still 16 Oct.
  const EVENING = Date.UTC(2026, 9, 16, 12, 30);
  const MONDAY_OPEN = Date.UTC(2026, 9, 19, 4, 30);

  const stale: BarsResult = {
    bars: [
      { date: '2026-10-14', open: 1, high: 1, low: 1, close: 100, adjClose: 100, volume: 1 },
      { date: '2026-10-15', open: 1, high: 1, low: 1, close: 101, adjClose: 101, volume: 1 },
    ],
    currency: 'INR',
    adjusted: true,
    provider: 'yahoo',
  };

  function setup(scraped: { close: number; sessionDate: string } | Error, now: number) {
    const scrapes: string[] = [];
    const yahoo: MarketDataProvider = {
      id: 'yahoo',
      supports: (cap) => cap === 'BARS',
      getDailyBars: async () => stale,
    };
    const page: MarketDataProvider = {
      id: 'quotepage',
      supports: (cap) => cap === 'LATEST_CLOSE',
      getLatestClose: async (r) => {
        scrapes.push(String(r.key));
        if (scraped instanceof Error) throw scraped;
        return { ...scraped, currency: 'INR' };
      },
    };
    const kv = createKeyValueCache(memoryRawStore());
    const svc = createMarketDataService({ providers: [yahoo, page], kv, clock: { now: () => now } });
    return { svc, scrapes };
  }

  it('uses the scraped close of the expected session while the market is closed', async () => {
    const { svc, scrapes } = setup({ close: 105, sessionDate: '2026-10-16' }, EVENING);
    const s = (await svc.getSnapshots([ref()], { force: false })).snapshots.get('NSE:RELIANCE');
    expect(s).toMatchObject({
      close: 105,
      prevClose: 101,
      sessionDate: '2026-10-16',
      stale: false,
      priceSource: 'SCRAPE',
      indicatorsAsOf: '2026-10-15',
    });
    expect(s?.bars).toHaveLength(2);
    expect(scrapes).toEqual(['NSE:RELIANCE']);
    // Kept for the instant render until bars for that session arrive.
    expect(svc.cachedSnapshots([ref()]).get('NSE:RELIANCE')?.priceSource).toBe('SCRAPE');
  });

  it('never scrapes while the market is open (it would be an intraday price)', async () => {
    const { svc, scrapes } = setup({ close: 105, sessionDate: '2026-10-19' }, MONDAY_OPEN);
    const s = (await svc.getSnapshots([ref()], { force: false })).snapshots.get('NSE:RELIANCE');
    expect(scrapes).toEqual([]);
    expect(s).toMatchObject({ stale: true, priceSource: 'BARS', close: 101 });
  });

  it('ignores a page that is no newer than the bars, and survives a broken page', async () => {
    const old = setup({ close: 99, sessionDate: '2026-10-15' }, EVENING);
    const s = (await old.svc.getSnapshots([ref()], { force: false })).snapshots.get('NSE:RELIANCE');
    expect(s).toMatchObject({ priceSource: 'BARS', close: 101, stale: true });

    const broken = setup(new ServiceError('BAD_RESPONSE', 'quotepage'), EVENING);
    const b = (await broken.svc.getSnapshots([ref()], { force: false })).snapshots.get('NSE:RELIANCE');
    expect(b).toMatchObject({ priceSource: 'BARS', stale: true });
  });
});
