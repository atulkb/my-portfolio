import {
  AppError,
  performanceRatingTask,
  type GenerateRequest,
  type GenerateResult,
  type GenerativePort,
  type MacroAssessment,
  type MarketSentimentInput,
  type PerformanceInput,
  type SignalInput,
} from '@portfolio/core';

import { createAiStore } from '@/stores/aiStore';
import { createKeyValueCache, memoryRawStore } from '../cache/kv';
import { createAiClient, parseModelJson, type AiClientConfig } from './aiClient';
import { AI_KEYS, createAiService, type AiItem } from './aiService';
import { createAiUsage } from './usage';

const CONFIG: AiClientConfig = {
  maxRetries: 2,
  retryBackoffMs: [1000, 3000],
  batchSize: 25,
  requestTimeoutMs: 20_000,
};

const perf = (symbol: string, over: Partial<PerformanceInput> = {}): PerformanceInput => ({
  symbol,
  exchange: 'NSE',
  pnlPct: 12.5,
  xirrPct: 18.2,
  benchmark: 'Nifty 50',
  benchmarkReturnPct: 10.1,
  excessReturnPp: 8.1,
  holdingDays: 400,
  healthScore: 66,
  healthLabel: 'GOOD',
  drawdownPct: -8,
  volatilityPct: 22,
  ...over,
});
const item = (
  symbol: string,
  over: Partial<PerformanceInput> = {},
  sessionDate = '2026-10-16',
): AiItem<PerformanceInput> => ({
  key: `NSE:${symbol}`,
  sessionDate,
  input: perf(symbol, over),
});

const macro: MacroAssessment = {
  indiaVix: { value: 14.02, level: 'CALM' },
  vix: { value: 16.46, level: 'ELEVATED' },
  nifty: { pctVsSma200: -4.32, regime: 'BELOW' },
  sp500: { pctVsSma200: 6.56, regime: 'ABOVE' },
};

const ratingsReply = (symbols: string[], reason = 'Beat Nifty 50 by 8.1 pp.'): GenerateResult => ({
  text: JSON.stringify({
    ratings: symbols.map((symbol) => ({ symbol, exchange: 'NSE', rating: 'GOOD', reason })),
  }),
  finishReason: 'STOP',
  usage: { promptTokens: 100, outputTokens: 40, thoughtsTokens: 0 },
});

/** Fake model: replies come from a queue; every request is recorded. */
function fakePort(replies: (GenerateResult | Error | ((req: GenerateRequest) => GenerateResult))[]) {
  const requests: GenerateRequest[] = [];
  const port: GenerativePort = {
    generate: (req) => {
      requests.push(req);
      const next = replies.shift();
      if (next === undefined) return Promise.reject(new Error('no reply queued'));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(typeof next === 'function' ? next(req) : next);
    },
  };
  return { port, requests };
}

function setup(
  replies: Parameters<typeof fakePort>[0],
  limits = { rpm: 100, dailyCap: 500, maxWaitMs: 60_000 },
) {
  let now = Date.parse('2026-10-16T12:00:00Z');
  const clock = { now: () => now };
  const sleeps: number[] = [];
  const sleep = (ms: number) => {
    sleeps.push(ms);
    now += ms;
    return Promise.resolve();
  };
  const raw = memoryRawStore();
  const kv = createKeyValueCache(raw);
  const usage = createAiUsage({ kv, clock, sleep, limits });
  const { port, requests } = fakePort(replies);
  const client = createAiClient({ port, usage, config: CONFIG, sleep });
  const service = createAiService({ client, usage, kv, clock });
  return { service, client, usage, kv, raw, requests, sleeps, advance: (ms: number) => (now += ms) };
}

describe('parseModelJson', () => {
  it('parses plain and fenced JSON, rejects junk', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('not json')).toBeUndefined();
  });
});

describe('AI usage budget', () => {
  it('blocks the 501st call of the day (LLD §3.10)', async () => {
    const t = setup([]);
    for (let i = 0; i < 500; i++) {
      await t.usage.acquire();
      t.advance(1000);
    }
    expect(t.usage.leftToday()).toBe(0);
    await expect(t.usage.acquire()).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  });

  it('waits for a free per-minute slot', async () => {
    const t = setup([], { rpm: 2, dailyCap: 500, maxWaitMs: 60_000 });
    await t.usage.acquire();
    await t.usage.acquire();
    await t.usage.acquire();
    expect(t.sleeps).toEqual([60_000]);
    expect(t.usage.usedToday()).toBe(3);
  });

  it('gives up when the per-minute wait is longer than allowed', async () => {
    const t = setup([], { rpm: 1, dailyCap: 500, maxWaitMs: 1000 });
    await t.usage.acquire();
    await expect(t.usage.acquire()).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  });
});

describe('AI client batches', () => {
  it('retries only the missing items', async () => {
    const t = setup([ratingsReply(['A']), ratingsReply(['B'])]);
    const run = await t.client.runBatch(performanceRatingTask, [perf('A'), perf('B')], null);
    expect(run.results.get('NSE:A')).toMatchObject({ rating: 'GOOD' });
    expect(run.results.get('NSE:B')).toMatchObject({ rating: 'GOOD' });
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1]?.prompt.user).toContain('"symbol":"B"');
    expect(t.requests[1]?.prompt.user).not.toContain('"symbol":"A"');
    expect(t.requests[1]?.prompt.user).toContain('Missing from the response');
  });

  it('stops after 3 attempts and returns null for invalid items', async () => {
    const stray = ratingsReply(['A'], 'Up 99.9% this year.'); // 99.9 is not in the data
    const t = setup([stray, stray, stray, stray]);
    const run = await t.client.runBatch(performanceRatingTask, [perf('A')], null);
    expect(run.results.get('NSE:A')).toBeNull();
    expect(run.calls).toBe(3);
    expect(t.sleeps).toEqual([1000, 3000]);
  });

  it('retries truncated replies and invalid JSON', async () => {
    const t = setup([
      { text: '{"ratings":[', finishReason: 'MAX_TOKENS', usage: null },
      { text: 'oops', finishReason: 'STOP', usage: null },
      ratingsReply(['A']),
    ]);
    const run = await t.client.runBatch(performanceRatingTask, [perf('A')], null);
    expect(run.results.get('NSE:A')).not.toBeNull();
    expect(run.calls).toBe(3);
  });

  it('does not retry 429 or blocked answers', async () => {
    for (const code of ['AI_RATE_LIMITED', 'AI_BLOCKED', 'AI_NOT_AUTHORISED'] as const) {
      const t = setup([new AppError(code)]);
      const run = await t.client.runBatch(performanceRatingTask, [perf('A')], null);
      expect(run.error?.code).toBe(code);
      expect(run.calls).toBe(1);
    }
  });

  it('retries timeouts and 5xx', async () => {
    const t = setup([new AppError('AI_TIMEOUT', { retryable: true }), ratingsReply(['A'])]);
    const run = await t.client.runBatch(performanceRatingTask, [perf('A')], null);
    expect(run.results.get('NSE:A')).not.toBeNull();
    expect(run.error).toBeNull();
  });

  it('splits more than 25 items into several calls', async () => {
    const symbols = Array.from({ length: 30 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${i}`);
    const reply = (req: GenerateRequest): GenerateResult => {
      const sent = [...req.prompt.user.matchAll(/"symbol":"([^"]+)"/g)].map((m) => m[1] ?? '');
      return ratingsReply(sent);
    };
    const t = setup([reply, reply]);
    const run = await t.client.runBatch(
      performanceRatingTask,
      symbols.map((s) => perf(s)),
      null,
    );
    expect(t.requests).toHaveLength(2);
    expect([...run.results.values()].every((v) => v !== null)).toBe(true);
  });
});

describe('AI service cache (D26)', () => {
  it('serves fresh entries without a call; re-rates only changed inputs', async () => {
    const t = setup([ratingsReply(['A', 'B']), ratingsReply(['B'])]);
    await t.service.ratePerformance([item('A'), item('B')], { force: false });
    expect(t.requests).toHaveLength(1);

    const again = await t.service.ratePerformance([item('A'), item('B')], { force: false });
    expect(again.calls).toBe(0);
    expect(t.requests).toHaveLength(1);

    // A new buy changes B's inputs only.
    await t.service.ratePerformance([item('A'), item('B', { pnlPct: 3.2 })], { force: false });
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1]?.prompt.user).not.toContain('"symbol":"A"');
  });

  it('re-rates on a new session and when forced', async () => {
    const t = setup([ratingsReply(['A']), ratingsReply(['A']), ratingsReply(['A'])]);
    await t.service.ratePerformance([item('A')], { force: false });
    await t.service.ratePerformance([item('A', {}, '2026-10-17')], { force: false });
    expect(t.requests).toHaveLength(2);
    await t.service.ratePerformance([item('A', {}, '2026-10-17')], { force: true });
    expect(t.requests).toHaveLength(3);
  });

  it('keeps the older entry when a re-rate fails, and reports the failure', async () => {
    const stray = ratingsReply(['A'], 'Up 77.7%.');
    const t = setup([ratingsReply(['A']), stray, stray, stray]);
    await t.service.ratePerformance([item('A')], { force: false });
    const res = await t.service.ratePerformance([item('A', { pnlPct: 1 })], { force: false });
    expect(res.failed).toEqual(['NSE:A']);
    expect(res.entries['NSE:A']?.value.rating).toBe('GOOD');
  });

  it('caches deep analysis per session and input; drops unknown alternatives', async () => {
    const reply: GenerateResult = {
      text: JSON.stringify({
        summary: 'Health score 66 with strong ROE.',
        pros: [{ paramKey: 'roe', text: 'ROE is strong.' }],
        cons: [],
        risks: ['Valuation is high.'],
        watchFor: ['Next quarterly results.'],
        alternatives: [
          { symbol: 'TCS', exchange: 'NSE', reason: 'Large IT peer.' },
          { symbol: 'FAKECO', exchange: 'NSE', reason: 'Invented.' },
        ],
      }),
      finishReason: 'STOP',
      usage: null,
    };
    const t = setup([reply]);
    const input = {
      symbol: 'INFY',
      exchange: 'NSE' as const,
      name: 'Infosys',
      sector: 'Technology',
      params: [{ key: 'roe' as const, group: 'FUNDAMENTAL' as const, value: 28, level: 'GOOD' as const }],
      healthScore: 66,
      healthLabel: 'GOOD' as const,
      macro,
      position: null,
      allowAlternatives: true,
    };
    const it1 = { key: 'NSE:INFY' as const, sessionDate: '2026-10-16', input };
    const exists = (_e: string, s: string) => s === 'TCS';
    const e = await t.service.deepAnalysis(it1, { force: false, exists });
    expect(e.value.alternatives.map((a) => a.symbol)).toEqual(['TCS']);
    expect(t.service.isAnalysisFresh(it1)).toBe(true);
    await t.service.deepAnalysis(it1, { force: false, exists });
    expect(t.requests).toHaveLength(1); // re-open costs 0 calls
    expect(t.service.isAnalysisFresh({ ...it1, sessionDate: '2026-10-17' })).toBe(false);
  });

  it('caches the market note and rejects advice wording', async () => {
    const bad: GenerateResult = {
      text: JSON.stringify({
        headline: 'Time to buy',
        paragraph: 'Nifty is 4.32% below its 200-day average.',
      }),
      finishReason: 'STOP',
      usage: null,
    };
    const good: GenerateResult = {
      text: JSON.stringify({
        headline: 'Calm India, cautious US',
        paragraph: 'Nifty is 4.32% below its 200-day average.',
      }),
      finishReason: 'STOP',
      usage: null,
    };
    const t = setup([bad, good]);
    const input: MarketSentimentInput = { macro, usdInr: { rate: 88.1, changePct: 0.12 } };
    const e = await t.service.marketSentiment('2026-10-16', input, { force: false });
    expect(e.value.headline).toBe('Calm India, cautious US');
    expect(t.requests).toHaveLength(2);
    expect(t.service.isSentimentFresh('2026-10-16', input)).toBe(true);
  });

  it('prunes entries older than 5 days', async () => {
    const t = setup([ratingsReply(['A'])]);
    await t.service.ratePerformance([item('A', {}, '2026-10-05')], { force: false });
    t.service.prune('2026-10-16');
    expect(t.service.cachedPerformance()).toEqual({});
    expect(t.raw.data.has(AI_KEYS.performance)).toBe(true);
  });
});

describe('AI store', () => {
  const signal = (symbol: string): SignalInput => ({
    symbol,
    exchange: 'NSE',
    scope: 'PORTFOLIO',
    healthScore: null,
    healthLabel: null,
    insufficientData: true,
    params: [],
    pnlPct: 2,
    targetEntryPrice: null,
    targetExitPrice: null,
  });

  it('does not re-send inputs that already failed this session', async () => {
    const stray = ratingsReply(['A'], 'Up 55.5%.');
    const t = setup([stray, stray, stray]);
    const store = createAiStore({ service: t.service, now: () => 0 });
    await store.getState().ratePerformance([item('A')], { force: false });
    expect(t.requests).toHaveLength(3);
    await store.getState().ratePerformance([item('A')], { force: false });
    expect(t.requests).toHaveLength(3);
    expect(store.getState().performance['NSE:A']).toBeUndefined();
  });

  it('shows a budget notice once per session', async () => {
    const t = setup([], { rpm: 100, dailyCap: 0, maxWaitMs: 0 });
    const notices: string[] = [];
    const store = createAiStore({ service: t.service, now: () => 0, onNotice: (c) => notices.push(c) });
    await store
      .getState()
      .generateSignals([{ key: 'NSE:A', sessionDate: '2026-10-16', input: signal('A') }], macro, {
        force: false,
      });
    await store.getState().ratePerformance([item('B')], { force: false });
    expect(notices).toEqual(['AI_BUDGET_EXCEEDED']);
    expect(store.getState().status.performance.failure).toBe('AI_BUDGET_EXCEEDED');
  });

  it('hydrates cached ratings for an instant render', async () => {
    const t = setup([ratingsReply(['A'])]);
    await t.service.ratePerformance([item('A')], { force: false });
    const store = createAiStore({ service: t.service, now: () => 0 });
    store.getState().hydrate('2026-10-16');
    expect(store.getState().performance['NSE:A']?.value.rating).toBe('GOOD');
  });
});
