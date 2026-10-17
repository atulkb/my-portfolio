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
  type SinglePromptTask,
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

type SetupOpts = {
  rpm?: number;
  maxWaitMs?: number;
  models?: readonly { id: string; dailyLimit: number }[];
};

function setup(replies: Parameters<typeof fakePort>[0], opts: SetupOpts = {}) {
  const limits = { rpm: opts.rpm ?? 100, maxWaitMs: opts.maxWaitMs ?? 60_000, cooldownMs: 3_600_000 };
  const models = opts.models ?? [{ id: 'model-a', dailyLimit: 500 }];
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
  const usage = createAiUsage({ kv, clock, sleep, limits, models, timeZone: 'America/Los_Angeles' });
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
    const t = setup([], { rpm: 2 });
    await t.usage.acquire();
    await t.usage.acquire();
    await t.usage.acquire();
    expect(t.sleeps).toEqual([60_000]);
    expect(t.usage.usedToday()).toBe(3);
  });

  it('gives up when the per-minute wait is longer than allowed', async () => {
    const t = setup([], { rpm: 1, maxWaitMs: 1000 });
    await t.usage.acquire();
    await expect(t.usage.acquire()).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  });
});

/** Minimal task: any JSON reply is accepted. */
const echoTask: SinglePromptTask<null, string> = {
  id: 'marketSentiment',
  version: 'echo@1',
  responseSchema: { type: 'object', properties: {} },
  build: () => ({ system: 's', user: 'u' }),
  validate: () => ({ ok: true, value: 'x' }),
};

describe('model chain (HLD D36)', () => {
  const chain = [
    { id: 'best', dailyLimit: 2 },
    { id: 'next', dailyLimit: 2 },
    { id: 'lite', dailyLimit: 500 },
  ];
  const ok: GenerateResult = { text: '{}', finishReason: 'STOP', usage: null };

  it('uses the best model until its daily quota is used, then steps down', async () => {
    const t = setup([], { models: chain });
    const used: string[] = [];
    for (let i = 0; i < 5; i++) used.push(await t.usage.acquire());
    expect(used).toEqual(['best', 'best', 'next', 'next', 'lite']);
    expect(t.usage.currentModel()).toBe('lite');
    expect(t.usage.dailyTotal()).toBe(504);
    expect(t.usage.leftToday()).toBe(499);
  });

  it('starts again at the top on the next Pacific-time quota day', async () => {
    const t = setup([], { models: chain });
    for (let i = 0; i < 4; i++) await t.usage.acquire();
    expect(t.usage.currentModel()).toBe('lite');
    // 2026-10-16 12:00 UTC is 05:00 in California; 20 h later it is the next Pacific day.
    t.advance(20 * 3_600_000);
    expect(t.usage.currentModel()).toBe('best');
  });

  it('moves to the next model at once on a 429 and cools the limited one down for an hour', async () => {
    const t = setup([new AppError('AI_RATE_LIMITED'), ok], { models: chain });
    const r = await t.client.runSingle(echoTask, null);
    expect(t.requests.map((q) => q.model)).toEqual(['best', 'next']);
    expect(r).toMatchObject({ model: 'next', calls: 2 });
    expect(t.usage.currentModel()).toBe('next');
    t.advance(3_600_001);
    expect(t.usage.currentModel()).toBe('best');
  });

  it('skips a model the project does not have (404)', async () => {
    const t = setup([new AppError('AI_UNAVAILABLE', { context: { status: 404 } }), ok], { models: chain });
    const r = await t.client.runSingle(echoTask, null);
    expect(r.model).toBe('next');
    expect(t.usage.currentModel()).toBe('next');
  });

  it('reports the budget as exceeded only when every model is used up', async () => {
    const t = setup([], { models: [{ id: 'only', dailyLimit: 1 }] });
    await t.usage.acquire();
    await expect(t.usage.acquire()).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    expect(t.usage.currentModel()).toBeNull();
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

  it('does not retry a 429 on the same model: with no other model left the budget is spent', async () => {
    const t = setup([new AppError('AI_RATE_LIMITED')]);
    const run = await t.client.runBatch(performanceRatingTask, [perf('A')], null);
    expect(run.error?.code).toBe('AI_BUDGET_EXCEEDED');
    expect(run.calls).toBe(1);
  });

  it('does not retry blocked or unauthorised answers', async () => {
    for (const code of ['AI_BLOCKED', 'AI_NOT_AUTHORISED'] as const) {
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

describe('AI service rule compile', () => {
  const reply = (body: unknown): GenerateResult => ({
    text: JSON.stringify(body),
    finishReason: 'STOP',
    usage: { promptTokens: 900, outputTokens: 60, thoughtsTokens: 0 },
  });
  const input = { text: 'RSI below 30', appliesToPortfolio: true, appliesToWatchlists: false };

  it('returns the validated rule with the model and prompt version, never cached', async () => {
    const ok = reply({ status: 'OK', logicJson: '{"<":[{"var":"rsi14"},30]}', suggestedName: 'Oversold' });
    const t = setup([ok, ok]);
    const first = await t.service.compileRule(input);
    expect(first.result).toMatchObject({ status: 'OK', readBack: expect.stringContaining('RSI') });
    expect(first.promptVersion).toBe('rule-compile@1');
    expect(first.model).toBe('model-a');
    await t.service.compileRule(input);
    expect(t.requests).toHaveLength(2);
    expect(t.usage.usedToday()).toBe(2);
  });

  it('retries a variable outside the whitelist with the validator feedback', async () => {
    const t = setup([
      reply({ status: 'OK', logicJson: '{"<":[{"var":"peRatio"},20]}' }),
      reply({ status: 'OK', logicJson: '{"<":[{"var":"pe"},20]}' }),
    ]);
    const r = await t.service.compileRule({ ...input, text: 'PE under 20' });
    expect(r.result.status).toBe('OK');
    expect(t.requests[1]?.prompt.user).toContain('peRatio');
  });

  it('passes UNSUPPORTED through (e.g. intraday timeframes)', async () => {
    const t = setup([reply({ status: 'UNSUPPORTED', reason: 'Needs 4-hour candles.' })]);
    const r = await t.service.compileRule({ ...input, text: 'RSI on 4H below 30' });
    expect(r.result).toEqual({ status: 'UNSUPPORTED', reason: 'Needs 4-hour candles.' });
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
    const t = setup([], { models: [{ id: 'model-a', dailyLimit: 0 }], maxWaitMs: 0 });
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
