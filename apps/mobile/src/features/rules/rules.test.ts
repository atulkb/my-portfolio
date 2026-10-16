import {
  computeIndicators,
  type DailyBar,
  type InstrumentKey,
  type Rule,
  type RuleResult,
  type StockHolding,
  type WatchlistItem,
} from '@portfolio/core';

import type { AiEntry } from '@/services/ai/aiService';
import type { PricedSnapshot } from '@/services/market-data/marketDataService';
import type { AnalysisEntry } from '@/stores/analysisStore';
import { buildWatchlistRows, filterWatchlistRows } from '../watchlist/rows';
import { buildRuleCandidates } from './candidates';
import { filterRuleCards, splitReadBack, summariseRules } from './summary';

const item = (symbol: string, over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  schemaVersion: 1,
  symbol,
  exchange: 'NASDAQ',
  targetEntryPrice: null,
  targetExitPrice: null,
  notes: null,
  addedAt: 1,
  updatedAt: 1,
  ...over,
});

const bars = (closes: number[]): DailyBar[] =>
  closes.map((c, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c,
    low: c,
    close: c,
    adjClose: c,
    volume: 1000,
  }));

const snap = (key: string, closes: number[]): PricedSnapshot =>
  ({
    key: key as InstrumentKey,
    close: closes.at(-1) ?? 0,
    prevClose: closes.at(-2) ?? null,
    bars: bars(closes),
    sessionDate: '2026-10-16',
    stale: false,
  }) as unknown as PricedSnapshot;

const signal = (label: 'BUY' | 'SELL', createdAt: number): AiEntry<never> =>
  ({
    sessionDate: '2026-10-16',
    inputHash: 'h',
    model: 'm',
    promptVersion: 'v',
    createdAt,
    value: { label, confidencePct: 80, targetEntryPrice: null, reason: 'r' },
  }) as unknown as AiEntry<never>;

describe('watchlist rows', () => {
  const rows = buildWatchlistRows({
    items: [
      item('NVDA', { addedAt: 2, targetEntryPrice: 120 }),
      item('AAPL'),
      item('INFY', { exchange: 'NSE' }),
    ],
    snapshots: new Map([
      ['NASDAQ:AAPL' as InstrumentKey, snap('NASDAQ:AAPL', [200, 210])],
      ['NASDAQ:NVDA' as InstrumentKey, snap('NASDAQ:NVDA', [100, 95])],
    ]),
    analysis: new Map(),
    signals: {
      ['NASDAQ:AAPL' as InstrumentKey]: signal('BUY', 10),
      ['NASDAQ:NVDA' as InstrumentKey]: signal('SELL', 20),
    },
    suggestions: true,
    nameOf: (k) => (k === 'NASDAQ:AAPL' ? 'Apple Inc.' : null),
  });

  it('keeps the order stocks were added and computes the day change', () => {
    expect(rows.map((r) => r.symbol)).toEqual(['AAPL', 'INFY', 'NVDA']);
    expect(rows[0]?.name).toBe('Apple Inc.');
    expect(rows[0]?.dayChangePct).toBeCloseTo(5, 2);
    expect(rows[1]).toMatchObject({
      close: null,
      dayChangePct: null,
      currency: 'INR',
      market: 'IN',
      name: 'INFY',
    });
    expect(rows[2]?.item.targetEntryPrice).toBe(120);
  });

  it('filters by market and signal and counts signals', () => {
    const us = filterWatchlistRows(rows, { market: 'US', signal: null });
    expect(us.marketRows).toBe(2);
    expect(us.signalCounts).toMatchObject({ BUY: 1, SELL: 1, HOLD: 0 });
    expect(us.signalsAsOf).toBe(20);
    expect(filterWatchlistRows(rows, { market: null, signal: 'SELL' }).rows.map((r) => r.symbol)).toEqual([
      'NVDA',
    ]);
    expect(filterWatchlistRows(rows, { market: 'IN', signal: null }).signalsAsOf).toBeNull();
  });

  it('hides signals when AI suggestions are off', () => {
    const off = buildWatchlistRows({
      items: [item('AAPL')],
      snapshots: new Map(),
      analysis: new Map(),
      signals: { ['NASDAQ:AAPL' as InstrumentKey]: signal('BUY', 10) },
      suggestions: false,
      nameOf: () => null,
    });
    expect(off[0]?.signal).toBeNull();
  });
});

describe('rule summary', () => {
  const base: Omit<Rule, 'id'> = {
    schemaVersion: 1,
    name: 'r',
    naturalPrompt: 'RSI below 30',
    compiledLogicJson: '{}',
    readBack: 'RSI (14) is below 30 AND Previous 50-day moving average is below 50-day moving average',
    variables: ['rsi14', 'sma50Prev', 'sma50'],
    appliesToPortfolio: true,
    appliesToWatchlists: false,
    enabled: true,
    compiledWith: { model: 'm', promptVersion: 'v' },
    createdAt: 1,
    updatedAt: 1,
  };
  const rules: Rule[] = [
    { ...base, id: 'a' },
    { ...base, id: 'b', appliesToPortfolio: false, appliesToWatchlists: true },
    { ...base, id: 'c', enabled: false },
  ];
  const result = (ruleId: string, keys: string[]): RuleResult => ({
    schemaVersion: 1,
    ruleId,
    sessionDate: '2026-10-16',
    evaluatedAt: 1,
    matches: keys.map((k) => ({ instrumentKey: k as InstrumentKey, scope: 'PORTFOLIO' })),
  });

  it('counts active, paused and triggered rules; paused results are ignored', () => {
    const s = summariseRules(
      rules,
      new Map(),
      new Map([
        ['a', result('a', ['NSE:INFY', 'NASDAQ:NVDA'])],
        ['c', result('c', ['NSE:TCS'])],
      ]),
      new Map([['b', [1, 2]]]),
    );
    expect(s).toMatchObject({ active: 2, paused: 1, triggered: 1 });
    expect(s.triggeredSymbols).toEqual(['INFY', 'NVDA']);
    expect(s.counts).toEqual({ ALL: 3, PORTFOLIO: 2, WATCHLIST: 1, PAUSED: 1 });
    expect(s.cards.find((c) => c.rule.id === 'b')?.insufficientCount).toBe(2);
    expect(filterRuleCards(s.cards, 'WATCHLIST').map((c) => c.rule.id)).toEqual(['b']);
    expect(filterRuleCards(s.cards, 'PAUSED').map((c) => c.rule.id)).toEqual(['c']);
  });

  it('highlights variable labels in the read-back, longest first', () => {
    const parts = splitReadBack(base.readBack, base.variables);
    expect(parts.filter((p) => p.variable).map((p) => p.text)).toEqual([
      'RSI (14)',
      'Previous 50-day moving average',
      '50-day moving average',
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(base.readBack);
  });
});

describe('rule candidates', () => {
  const entry = (closes: number[]): AnalysisEntry =>
    ({
      indicators: computeIndicators(bars(closes)),
      analysis: { healthScore: 70, healthLabel: 'GOOD' },
      sectorCategory: 'TECH',
    }) as unknown as AnalysisEntry;
  const holding = {
    key: 'NSE:INFY' as InstrumentKey,
    pnlPct: 12,
    performance: 'GOOD',
  } as unknown as StockHolding;

  const candidates = buildRuleCandidates({
    holdings: [holding],
    watchItems: [
      item('AAPL', { targetEntryPrice: null }),
      item('AAPL', { targetEntryPrice: 180 }),
      item('INFY', { exchange: 'NSE' }),
    ],
    analysis: new Map([['NSE:INFY' as InstrumentKey, entry([10, 11])]]),
    market: { fundamentals: new Map(), macro: null },
    sector: { overrides: undefined, profiles: new Map(), index: null },
  });

  it('builds one portfolio candidate per holding and one watchlist candidate per stock', () => {
    expect(candidates.map((c) => `${c.scope}:${c.key}`)).toEqual([
      'PORTFOLIO:NSE:INFY',
      'WATCHLIST:NASDAQ:AAPL',
      'WATCHLIST:NSE:INFY',
    ]);
    const p = candidates[0]?.ctx;
    expect(p).toMatchObject({
      pnlPct: 12,
      performanceLabel: 'GOOD',
      close: 11,
      market: 'IN',
      targetEntryPrice: null,
    });
  });

  it('uses the first target set on any list and nulls for unpriced stocks', () => {
    const aapl = candidates[1]?.ctx;
    expect(aapl).toMatchObject({ targetEntryPrice: 180, close: null, pnlPct: null, exchange: 'NASDAQ' });
  });

  it('limits to one instrument when asked (S04 Rules tab)', () => {
    const only = buildRuleCandidates(
      {
        holdings: [holding],
        watchItems: [item('AAPL')],
        analysis: new Map(),
        market: { fundamentals: new Map(), macro: null },
        sector: { overrides: undefined, profiles: new Map(), index: null },
      },
      'NASDAQ:AAPL' as InstrumentKey,
    );
    expect(only.map((c) => c.key)).toEqual(['NASDAQ:AAPL']);
  });
});
