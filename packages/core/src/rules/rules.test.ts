import type { IndicatorSet } from '../indicators/compute';
import { buildRuleContext } from './context';
import { dryRun, evaluateRule, type RuleContext } from './evaluate';
import { renderReadBack } from './readback';
import { checkRuleScopes, parseRuleLogicJson, validateRuleLogic, type ValidRule } from './validate';
import { RULE_VARIABLE_NAMES } from './variables';

function valid(ast: unknown): ValidRule {
  const r = validateRuleLogic(ast);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function issues(ast: unknown): string[] {
  const r = validateRuleLogic(ast);
  return r.ok ? [] : r.error.map((i) => i.code);
}

const v = (name: string) => ({ var: name });
const oversold = { and: [{ '<': [v('rsi14'), 30] }, { '<': [v('pe'), 20] }] };
const crossover = { and: [{ '<=': [v('sma20Prev'), v('sma50Prev')] }, { '>': [v('sma20'), v('sma50')] }] };

const baseCtx = Object.fromEntries(RULE_VARIABLE_NAMES.map((k) => [k, null])) as RuleContext;
const ctx = (p: Partial<Record<keyof RuleContext, number | string | null>>): RuleContext => ({
  ...baseCtx,
  ...p,
});

describe('validateRuleLogic', () => {
  it('accepts whitelisted logic and lists variables once, in order', () => {
    expect(valid(oversold).variables).toEqual(['rsi14', 'pe']);
    expect(valid(crossover).variables).toEqual(['sma20Prev', 'sma50Prev', 'sma20', 'sma50']);
    expect(valid({ in: [v('sector'), ['Technology', 'Energy']] }).variables).toEqual(['sector']);
    expect(valid({ '>': [v('volume'), { '*': [2, v('avgVolume30')] }] }).variables).toEqual([
      'volume',
      'avgVolume30',
    ]);
    expect(valid({ '==': [v('market'), 'IN'] }).variables).toEqual(['market']);
    expect(valid({ '<': [v('close'), { var: ['sma200'] }] }).variables).toEqual(['close', 'sma200']);
  });

  it.each([
    ['unknown variable', { '<': [v('peRatio'), 20] }, 'UNKNOWN_VARIABLE'],
    ['prototype key as variable', { '<': [v('constructor'), 1] }, 'UNKNOWN_VARIABLE'],
    ['unknown operator', { merge: [1, 2] }, 'UNKNOWN_OPERATOR'],
    ['method call attempt', { method: [v('close'), 'toString'] }, 'UNKNOWN_OPERATOR'],
    ['two operators in one node', { '<': [1, 2], '>': [1, 2] }, 'SHAPE'],
    ['nested array outside in', { '<': [[1, 2], 3] }, 'SHAPE'],
    ['wrong arity', { '<': [v('pe')] }, 'ARITY'],
    ['comparing text with <', { '<': [v('sector'), 5] }, 'TYPE'],
    ['and over a number', { and: [v('pe'), { '<': [v('pe'), 1] }] }, 'TYPE'],
    ['bad enum value', { '==': [v('healthLabel'), 'GREAT'] }, 'ENUM_VALUE'],
    ['bad enum value in list', { in: [v('market'), ['IN', 'UK']] }, 'ENUM_VALUE'],
    ['mixed list', { in: [v('sector'), ['Tech', 5]] }, 'LITERAL'],
    ['long string', { '==': [v('sector'), 'x'.repeat(61)] }, 'LITERAL'],
    ['non-finite number', { '<': [v('pe'), Number.POSITIVE_INFINITY] }, 'LITERAL'],
    ['not a condition', { '+': [v('pe'), 1] }, 'NOT_BOOLEAN'],
    ['bare variable', v('pe'), 'NOT_BOOLEAN'],
    ['null', null, 'SHAPE'],
  ])('rejects %s', (_label, ast, code) => {
    expect(issues(ast)).toContain(code);
  });

  it('rejects depth 11', () => {
    let ast: unknown = { '<': [v('pe'), 1] };
    for (let i = 0; i < 10; i++) ast = { '!': [ast] };
    expect(issues(ast)).toContain('TOO_DEEP');
  });

  it('rejects more than 100 nodes', () => {
    const many = Array.from({ length: 40 }, () => ({ '<': [v('pe'), 1] }));
    expect(issues({ or: many })).toContain('TOO_LARGE');
  });

  it('suggests the closest variable', () => {
    const r = validateRuleLogic({ '<': [v('rsi'), 30] });
    expect(r.ok ? '' : r.error[0]?.message).toContain('did you mean RSI (14)?');
  });

  it('parses JSON strings safely', () => {
    expect(parseRuleLogicJson('{"<":[{"var":"pe"},20]}').ok).toBe(true);
    const bad = parseRuleLogicJson('{not json');
    expect(bad.ok ? '' : bad.error[0]?.code).toBe('PARSE');
  });
});

describe('checkRuleScopes', () => {
  it('rejects portfolio-only variables on watchlists and vice versa', () => {
    expect(
      checkRuleScopes(['pnlPct'], { appliesToPortfolio: true, appliesToWatchlists: true })[0]?.message,
    ).toBe("This rule uses Your P/L %, so it can't apply to watchlists.");
    expect(
      checkRuleScopes(['targetEntryPrice'], { appliesToPortfolio: true, appliesToWatchlists: false }),
    ).toHaveLength(1);
    expect(checkRuleScopes(['rsi14'], { appliesToPortfolio: true, appliesToWatchlists: true })).toEqual([]);
  });
});

describe('evaluateRule', () => {
  it('matches, misses and reports insufficient data', () => {
    const rule = valid(oversold);
    expect(evaluateRule(rule, ctx({ rsi14: 25, pe: 15 }))).toBe('MATCH');
    expect(evaluateRule(rule, ctx({ rsi14: 45, pe: 15 }))).toBe('NO_MATCH');
    expect(evaluateRule(rule, ctx({ rsi14: 25, pe: null }))).toBe('INSUFFICIENT_DATA');
  });

  it('evaluates crossovers, membership, arithmetic and enums', () => {
    expect(
      evaluateRule(valid(crossover), ctx({ sma20Prev: 99, sma50Prev: 100, sma20: 101, sma50: 100 })),
    ).toBe('MATCH');
    expect(
      evaluateRule(valid(crossover), ctx({ sma20Prev: 101, sma50Prev: 100, sma20: 102, sma50: 100 })),
    ).toBe('NO_MATCH');
    expect(
      evaluateRule(valid({ in: [v('sector'), ['Technology', 'Energy']] }), ctx({ sector: 'Energy' })),
    ).toBe('MATCH');
    const volume = valid({ '>': [v('volume'), { '*': [2, v('avgVolume30')] }] });
    expect(evaluateRule(volume, ctx({ volume: 250, avgVolume30: 100 }))).toBe('MATCH');
    expect(evaluateRule(volume, ctx({ volume: 150, avgVolume30: 100 }))).toBe('NO_MATCH');
    expect(evaluateRule(valid({ '==': [v('healthLabel'), 'GOOD'] }), ctx({ healthLabel: 'GOOD' }))).toBe(
      'MATCH',
    );
  });

  it('dry-runs across candidates', () => {
    const r = dryRun(valid(oversold), [
      { key: 'NSE:INFY', scope: 'PORTFOLIO', ctx: ctx({ rsi14: 25, pe: 15 }) },
      { key: 'NASDAQ:AAPL', scope: 'WATCHLIST', ctx: ctx({ rsi14: 60, pe: 30 }) },
      { key: 'NSE:TCS', scope: 'WATCHLIST', ctx: ctx({ rsi14: 25, pe: null }) },
    ]);
    expect(r.matches).toEqual([{ key: 'NSE:INFY', scope: 'PORTFOLIO' }]);
    expect(r.insufficient).toEqual([{ key: 'NSE:TCS', scope: 'WATCHLIST' }]);
  });
});

describe('renderReadBack', () => {
  it.each([
    [oversold, 'RSI (14) is below 30 AND P/E is below 20'],
    [crossover, '20-day moving average crossed above 50-day moving average'],
    [
      { and: [{ '<': [v('rsi14'), 30] }, { '>=': [v('closePrev'), 100] }, { '<': [v('close'), 100] }] },
      'RSI (14) is below 30 AND Close price crossed below 100',
    ],
    [{ '>': [v('volume'), { '*': [2, v('avgVolume30')] }] }, 'Volume is above 2 × 30-day average volume'],
    [{ in: [v('sector'), ['Technology', 'Energy']] }, 'Sector is one of Technology, Energy'],
    [{ '==': [v('market'), 'IN'] }, 'Market is India'],
    [
      { or: [{ '<': [v('pe'), 15] }, { and: [{ '<': [v('pb'), 1] }, { '>': [v('roe'), 15] }] }] },
      'P/E is below 15 OR (P/B is below 1 AND ROE % is above 15)',
    ],
    [
      {
        and: [
          { or: [{ '<': [v('pe'), 15] }, { '<': [v('pb'), 1] }] },
          { '!': [{ '==': [v('healthLabel'), 'BAD'] }] },
        ],
      },
      '(P/E is below 15 OR P/B is below 1) AND NOT (Health is Bad)',
    ],
    [{ '>': [{ '-': [v('close'), v('sma50')] }, 5] }, 'Close price − 50-day moving average is above 5'],
    [{ '>': [{ '/': [{ '+': [v('close'), 1] }, 2] }, 5] }, '(Close price + 1) ÷ 2 is above 5'],
    [
      { if: [{ '==': [v('market'), 'IN'] }, { '>': [v('indiaVix'), 20] }, { '>': [v('vix'), 25] }] },
      '(if Market is India then India VIX is above 20, otherwise CBOE VIX is above 25)',
    ],
  ])('renders %j', (ast, text) => {
    expect(renderReadBack(valid(ast))).toBe(text);
  });
});

describe('buildRuleContext', () => {
  const indicators = { close: 101, rsi14: 28, sma200: 90 } as unknown as IndicatorSet;

  it('maps indicators, fundamentals, scores, scope values and macro', () => {
    const c = buildRuleContext({
      indicators,
      fundamentals: null,
      analysis: { healthScore: 70, healthLabel: 'GOOD' },
      macro: { indiaVix: 14, vix: 18, nifty: null, sp500: null },
      sector: 'Technology',
      market: 'IN',
      exchange: 'NSE',
      holding: { pnlPct: 12, performance: 'AVERAGE' },
    });
    expect(c).toMatchObject({
      close: 101,
      rsi14: 28,
      pe: null,
      healthLabel: 'GOOD',
      pnlPct: 12,
      performanceLabel: 'AVERAGE',
      targetEntryPrice: null,
      sector: 'Technology',
      market: 'IN',
      exchange: 'NSE',
      indiaVix: 14,
    });
    expect(Object.keys(c).sort()).toEqual([...RULE_VARIABLE_NAMES].sort());
  });
});
