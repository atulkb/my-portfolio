import {
  AppError,
  RULE_VARIABLE_NAMES,
  type InstrumentKey,
  type NewRule,
  type Rule,
  type RuleCandidate,
  type RuleContext,
  type RuleRepository,
  type RuleResult,
} from '@portfolio/core';

import { createRulesStore } from './rulesStore';

const fields: NewRule = {
  name: 'Oversold',
  naturalPrompt: 'RSI below 30',
  compiledLogicJson: '{"<":[{"var":"rsi14"},30]}',
  readBack: 'RSI (14) is below 30',
  variables: ['rsi14'],
  appliesToPortfolio: true,
  appliesToWatchlists: true,
  enabled: true,
  compiledWith: { model: 'gemini-3.5-flash', promptVersion: 'rule-compile@1' },
};

const rule = (id: string, over: Partial<Rule> = {}): Rule => ({
  ...fields,
  id,
  schemaVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const ctx = (rsi14: number | null): RuleContext =>
  ({ ...Object.fromEntries(RULE_VARIABLE_NAMES.map((k) => [k, null])), rsi14 }) as RuleContext;

const cand = (
  key: string,
  rsi: number | null,
  scope: 'PORTFOLIO' | 'WATCHLIST' = 'PORTFOLIO',
): RuleCandidate => ({
  key: key as InstrumentKey,
  scope,
  ctx: ctx(rsi),
});

function setup(rules: Rule[] = [rule('r1')], results: RuleResult[] = []) {
  const repo = {
    list: jest.fn(async () => ({ items: rules, skipped: 0 })),
    newId: () => 'new1',
    create: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    saveResults: jest.fn(async (_results: RuleResult[]) => undefined),
    listResults: jest.fn(async () => ({ items: results, skipped: 0 })),
    pruneResultsBefore: jest.fn(async () => undefined),
  } satisfies RuleRepository;
  const compile = jest.fn();
  const store = createRulesStore({ repo: () => repo, clock: { now: () => 99 }, compile });
  return { store, repo, compile };
}

describe('rulesStore', () => {
  it('re-validates stored logic on load (defence in depth)', async () => {
    const { store } = setup([rule('ok'), rule('bad', { compiledLogicJson: '{"eval":["x"]}' })]);
    await store.getState().load('2026-10-16');
    expect(store.getState().valid.get('ok')).not.toBeNull();
    expect(store.getState().valid.get('bad')).toBeNull();
  });

  it('evaluates enabled rules and writes only changed results', async () => {
    const { store, repo } = setup();
    await store.getState().load('2026-10-16');
    const candidates = [cand('NSE:INFY', 25), cand('NSE:TCS', null), cand('NASDAQ:AAPL', 40, 'WATCHLIST')];

    await store.getState().evaluateAll(candidates, '2026-10-16');
    expect(repo.saveResults).toHaveBeenCalledTimes(1);
    expect(repo.saveResults.mock.calls[0]?.[0]).toEqual([
      {
        schemaVersion: 1,
        ruleId: 'r1',
        sessionDate: '2026-10-16',
        matches: [{ instrumentKey: 'NSE:INFY', scope: 'PORTFOLIO' }],
        evaluatedAt: 99,
      },
    ]);
    expect(store.getState().insufficient.get('r1')).toEqual([{ key: 'NSE:TCS', scope: 'PORTFOLIO' }]);
    expect(repo.pruneResultsBefore).toHaveBeenCalledWith('2026-09-16');

    // Same matches again: nothing written, no second prune for the same session.
    await store.getState().evaluateAll(candidates, '2026-10-16');
    expect(repo.saveResults).toHaveBeenCalledTimes(1);
    expect(repo.pruneResultsBefore).toHaveBeenCalledTimes(1);
  });

  it('skips writing when the stored result for the session already matches', async () => {
    const stored: RuleResult = {
      schemaVersion: 1,
      ruleId: 'r1',
      sessionDate: '2026-10-16',
      matches: [{ instrumentKey: 'NSE:INFY' as InstrumentKey, scope: 'PORTFOLIO' }],
      evaluatedAt: 1,
    };
    const { store, repo } = setup([rule('r1')], [stored]);
    await store.getState().load('2026-10-16');
    await store.getState().evaluateAll([cand('NSE:INFY', 25)], '2026-10-16');
    expect(repo.saveResults).not.toHaveBeenCalled();
  });

  it('retries a failed result write on the next evaluation', async () => {
    const { store, repo } = setup();
    await store.getState().load('2026-10-16');
    repo.saveResults.mockRejectedValueOnce(new AppError('FS_UNAVAILABLE'));
    await store.getState().evaluateAll([cand('NSE:INFY', 25)], '2026-10-16');
    expect(store.getState().results.get('r1')?.matches).toHaveLength(1);
    await store.getState().evaluateAll([cand('NSE:INFY', 25)], '2026-10-16');
    expect(repo.saveResults).toHaveBeenCalledTimes(2);
  });

  it('ignores paused and invalid rules', async () => {
    const { store, repo } = setup([
      rule('paused', { enabled: false }),
      rule('bad', { compiledLogicJson: 'not json' }),
    ]);
    await store.getState().load('2026-10-16');
    await store.getState().evaluateAll([cand('NSE:INFY', 25)], '2026-10-16');
    expect(repo.saveResults).not.toHaveBeenCalled();
  });

  it('creates rules up to the limit of 25', async () => {
    const { store, repo } = setup([]);
    await store.getState().load('2026-10-16');
    expect(await store.getState().create(fields)).toBe('new1');
    expect(repo.create).toHaveBeenCalledWith('new1', fields);

    const full = setup(Array.from({ length: 25 }, (_, i) => rule(`r${i}`)));
    await full.store.getState().load('2026-10-16');
    expect(await full.store.getState().create(fields)).toBeNull();
    expect(full.store.getState().error).toBe('RULE_LIMIT');
  });

  it('rolls back a failed toggle', async () => {
    const { store, repo } = setup();
    await store.getState().load('2026-10-16');
    repo.update.mockRejectedValueOnce(new AppError('FS_UNAVAILABLE'));
    expect(await store.getState().toggle('r1', false)).toBe(false);
    expect(store.getState().rules[0]?.enabled).toBe(true);
    expect(store.getState().error).toBe('FS_UNAVAILABLE');
  });
});
