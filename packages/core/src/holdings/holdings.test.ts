import type { MarketSnapshot } from '../market/types';
import type { InstrumentKey } from '../models/primitives';
import type { BuyTransaction } from '../models/transaction';
import { aggregateHoldings } from './aggregate';
import { convert, rateOn } from './fx';
import { groupBySector, summarisePortfolio } from './summary';
import { NO_FILTERS, type PricingContext } from './types';

let seq = 0;
function buy(p: Partial<BuyTransaction> & Pick<BuyTransaction, 'symbol' | 'exchange'>): BuyTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    schemaVersion: 1,
    type: 'BUY',
    name: p.symbol,
    platform: 'Zerodha',
    quantity: 10,
    price: 100,
    tradeDate: '2024-01-15',
    source: 'MANUAL',
    importBatchId: null,
    createdAt: seq,
    updatedAt: seq,
    ...p,
  };
}

const snap = (
  key: InstrumentKey,
  close: number,
  prevClose: number | null,
  sessionDate = '2026-10-15',
): MarketSnapshot => ({
  key,
  sessionDate,
  close,
  prevClose,
  bars: [],
});

const SECTORS: Readonly<Record<string, string>> = {
  'NSE:RELIANCE': 'Energy',
  'NSE:INFY': 'Technology',
  'NASDAQ:AAPL': 'Technology',
};

function ctx(snaps: MarketSnapshot[], extra: Partial<PricingContext> = {}): PricingContext {
  return {
    valuationDate: '2026-10-15',
    snapshots: new Map(snaps.map((s) => [s.key, s])),
    fx: { usdInr: 80, asOf: '2026-10-15', history: [{ date: '2020-01-01', rate: 75 }] },
    sectorOf: (key) => SECTORS[key] ?? null,
    labels: new Map(),
    ...extra,
  };
}

const txs = [
  buy({ symbol: 'RELIANCE', exchange: 'NSE', quantity: 10, price: 2000, tradeDate: '2023-01-10' }),
  buy({ symbol: 'RELIANCE', exchange: 'NSE', quantity: 10, price: 2400, tradeDate: '2024-01-10' }),
  buy({
    symbol: 'RELIANCE',
    exchange: 'NSE',
    quantity: 5,
    price: 2800,
    tradeDate: '2025-01-10',
    platform: 'groww',
  }),
  buy({
    symbol: 'INFY',
    exchange: 'NSE',
    quantity: 4,
    price: 1500,
    tradeDate: '2026-06-01',
    platform: 'Groww',
  }),
  buy({
    symbol: 'AAPL',
    exchange: 'NASDAQ',
    quantity: 2.5,
    price: 150,
    tradeDate: '2022-05-02',
    platform: 'IBKR',
  }),
];
const pricing = ctx([
  snap('NSE:RELIANCE', 3000, 2950),
  snap('NSE:INFY', 1600, null),
  snap('NASDAQ:AAPL', 200, 198),
]);

describe('aggregateHoldings', () => {
  it('aggregates multiple buys across brokers into one card', () => {
    const rel = aggregateHoldings(txs, pricing, NO_FILTERS).find((h) => h.key === 'NSE:RELIANCE');
    expect(rel?.quantity).toBe(25);
    expect(rel?.invested).toBeCloseTo(58000, 6);
    expect(rel?.avgPrice).toBeCloseTo(2320, 6);
    expect(rel?.value).toBeCloseTo(75000, 6);
    expect(rel?.pnl).toBeCloseTo(17000, 6);
    expect(rel?.pnlPct).toBeCloseTo((17000 / 58000) * 100, 6);
    expect(rel?.dayChange).toBeCloseTo(25 * 50, 6);
    expect(rel?.dayChangePct).toBeCloseTo((3000 / 2950 - 1) * 100, 6);
    expect(rel?.xirrPct).not.toBeNull();
    expect(rel?.firstBuyDate).toBe('2023-01-10');
    expect(rel?.sector).toBe('Energy');
    expect(rel?.market).toBe('IN');
    expect(rel?.currency).toBe('INR');
  });

  it('groups brokers case-insensitively, sorted by invested', () => {
    const rel = aggregateHoldings(txs, pricing, NO_FILTERS).find((h) => h.key === 'NSE:RELIANCE');
    expect(rel?.brokers.map((b) => [b.platform, b.quantity])).toEqual([
      ['Zerodha', 20],
      ['groww', 5],
    ]);
    expect(rel?.brokers[0]?.avgPrice).toBeCloseTo(2200, 6);
    expect(rel?.brokers[0]?.buys.map((b) => b.tradeDate)).toEqual(['2023-01-10', '2024-01-10']);
  });

  it('computes quantity-weighted holding days', () => {
    const one = aggregateHoldings(
      [buy({ symbol: 'X', exchange: 'NSE', tradeDate: '2026-10-05' })],
      ctx([]),
      NO_FILTERS,
    );
    expect(one[0]?.holdingDays).toBeCloseTo(10, 9);
  });

  it('platform filter recomputes the card from matching buys only', () => {
    const groww = aggregateHoldings(txs, pricing, { ...NO_FILTERS, platforms: ['GROWW'] });
    expect(groww.map((h) => h.key).sort()).toEqual(['NSE:INFY', 'NSE:RELIANCE']);
    const rel = groww.find((h) => h.key === 'NSE:RELIANCE');
    expect(rel?.quantity).toBe(5);
    expect(rel?.avgPrice).toBeCloseTo(2800, 6);
    expect(rel?.xirrPct).not.toBeNull();
  });

  it('applies market, exchange, sector and label filters', () => {
    expect(aggregateHoldings(txs, pricing, { ...NO_FILTERS, markets: ['US'] }).map((h) => h.key)).toEqual([
      'NASDAQ:AAPL',
    ]);
    expect(aggregateHoldings(txs, pricing, { ...NO_FILTERS, exchanges: ['NASDAQ'] })).toHaveLength(1);
    expect(aggregateHoldings(txs, pricing, { ...NO_FILTERS, sectors: ['Technology'] })).toHaveLength(2);
    const labelled = ctx(pricing.snapshots.size ? [...pricing.snapshots.values()] : [], {
      labels: new Map([['NSE:INFY', { performance: 'BAD', health: null }]]),
    });
    expect(
      aggregateHoldings(txs, labelled, { ...NO_FILTERS, performance: ['BAD'] }).map((h) => h.key),
    ).toEqual(['NSE:INFY']);
    expect(aggregateHoldings(txs, labelled, { ...NO_FILTERS, performance: ['NONE'] })).toHaveLength(2);
    expect(aggregateHoldings(txs, labelled, { ...NO_FILTERS, health: ['NONE'] })).toHaveLength(3);
  });

  it('returns nulls, never zeros, without a snapshot', () => {
    const [h] = aggregateHoldings([buy({ symbol: 'NEW', exchange: 'BSE' })], ctx([]), NO_FILTERS);
    expect(h?.close).toBeNull();
    expect(h?.value).toBeNull();
    expect(h?.pnl).toBeNull();
    expect(h?.pnlPct).toBeNull();
    expect(h?.dayChange).toBeNull();
    expect(h?.xirrPct).toBeNull();
    expect(h?.sector).toBeNull();
  });

  it('xirr is null when the first buy is under a year old', () => {
    const infy = aggregateHoldings(txs, pricing, NO_FILTERS).find((h) => h.key === 'NSE:INFY');
    expect(infy?.xirrPct).toBeNull();
    expect(infy?.dayChangePct).toBeNull(); // no previous close
  });

  it('sorts by value across currencies (in INR), then by other keys', () => {
    // RELIANCE 75,000 INR; AAPL 500 USD = 40,000 INR; INFY 6,400 INR
    expect(aggregateHoldings(txs, pricing, NO_FILTERS).map((h) => h.symbol)).toEqual([
      'RELIANCE',
      'AAPL',
      'INFY',
    ]);
    expect(aggregateHoldings(txs, pricing, { ...NO_FILTERS, sort: 'NAME_ASC' }).map((h) => h.symbol)).toEqual(
      ['AAPL', 'INFY', 'RELIANCE'],
    );
    expect(
      aggregateHoldings(txs, pricing, { ...NO_FILTERS, sort: 'DAY_PNL_PCT_DESC' }).map((h) => h.symbol),
    ).toEqual([
      'RELIANCE',
      'AAPL',
      'INFY', // null last
    ]);
    expect(aggregateHoldings(txs, pricing, { ...NO_FILTERS, sort: 'PNL_PCT_DESC' })[0]?.symbol).toBe('AAPL');
  });
});

describe('groupBySector', () => {
  it('groups, converts mixed currencies for totals and weights, and orders by value', () => {
    const holdings = aggregateHoldings(txs, pricing, NO_FILTERS);
    const groups = groupBySector(holdings, pricing.fx, 'INR');
    expect(groups.map((g) => g.sector)).toEqual(['Energy', 'Technology']);
    const tech = groups[1];
    expect(tech?.value).toBeCloseTo(6400 + 500 * 80, 6);
    expect(tech?.weightPct).toBeCloseTo(((6400 + 40000) / (75000 + 46400)) * 100, 6);
    expect(groups.reduce((s, g) => s + (g.weightPct ?? 0), 0)).toBeCloseTo(100, 6);
  });

  it('puts unknown sectors under Unclassified', () => {
    const holdings = aggregateHoldings(
      [buy({ symbol: 'ZZZ', exchange: 'NSE' })],
      ctx([snap('NSE:ZZZ', 1, 1)]),
      NO_FILTERS,
    );
    expect(groupBySector(holdings, pricing.fx, 'USD')[0]?.sector).toBe('Unclassified');
  });
});

describe('summarisePortfolio', () => {
  it('summarises in the chosen currency with per-market blocks', () => {
    const holdings = aggregateHoldings(txs, pricing, NO_FILTERS);
    const inr = summarisePortfolio(holdings, pricing.fx, 'INR');
    expect(inr.totalValue).toBeCloseTo(75000 + 6400 + 40000, 6);
    expect(inr.invested).toBeCloseTo(58000 + 6000 + 375 * 80, 6);
    expect(inr.unrealisedPnl).toBeCloseTo(inr.totalValue - inr.invested, 6);
    expect(inr.dayChange).toBeCloseTo(1250 + 2.5 * 2 * 80, 6);
    expect(inr.unpricedCount).toBe(0);
    expect(inr.xirrPct).not.toBeNull();
    const us = inr.markets.find((m) => m.market === 'US');
    expect(us?.value).toBeCloseTo(500, 6);
    expect(us?.currency).toBe('USD');
    expect(us?.weightPct).toBeCloseTo((40000 / 121400) * 100, 6);
    const usd = summarisePortfolio(holdings, pricing.fx, 'USD');
    expect(usd.totalValue).toBeCloseTo(121400 / 80, 6);
  });

  it('excludes unpriced holdings and counts them', () => {
    const holdings = aggregateHoldings(
      [...txs, buy({ symbol: 'NEW', exchange: 'BSE' })],
      pricing,
      NO_FILTERS,
    );
    expect(summarisePortfolio(holdings, pricing.fx, 'INR').unpricedCount).toBe(1);
  });

  it('handles an empty portfolio', () => {
    const s = summarisePortfolio([], pricing.fx, 'INR');
    expect(s.totalValue).toBe(0);
    expect(s.unrealisedPnlPct).toBeNull();
    expect(s.dayChangePct).toBeNull();
    expect(s.xirrPct).toBeNull();
    expect(s.markets).toEqual([]);
  });

  it('portfolio XIRR is null when FX history is missing for a foreign-currency buy', () => {
    const holdings = aggregateHoldings(txs, pricing, NO_FILTERS);
    const s = summarisePortfolio(holdings, { ...pricing.fx, history: [] }, 'INR');
    expect(s.xirrPct).toBeNull();
  });
});

describe('fx helpers', () => {
  const fx = {
    usdInr: 83,
    asOf: '2026-10-15',
    history: [
      { date: '2020-01-02', rate: 71 },
      { date: '2020-01-06', rate: 72 },
    ],
  };

  it('converts both ways', () => {
    expect(convert(10, 'USD', 'INR', 83)).toBe(830);
    expect(convert(830, 'INR', 'USD', 83)).toBe(10);
    expect(convert(5, 'INR', 'INR', 83)).toBe(5);
  });

  it('uses the nearest earlier rate, or the first rate before history starts', () => {
    expect(rateOn(fx, '2020-01-04')).toBe(71);
    expect(rateOn(fx, '2020-01-06')).toBe(72);
    expect(rateOn(fx, '1995-05-05')).toBe(71);
    expect(rateOn({ ...fx, history: [] }, '2020-01-04')).toBeNull();
  });
});
