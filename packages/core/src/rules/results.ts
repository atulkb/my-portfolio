import type { InstrumentKey, IsoDate } from '../models/primitives';
import type { RuleResult } from '../models/rule';
import { MAX_RULE_MATCHES } from '../models/rule';
import { dryRun, type RuleCandidate } from './evaluate';
import type { ValidRule } from './validate';
import type { RuleScope } from './variables';

/** An enabled rule ready to evaluate (its stored logic already re-validated). */
export type RuleToRun = {
  readonly id: string;
  readonly rule: ValidRule;
  readonly appliesToPortfolio: boolean;
  readonly appliesToWatchlists: boolean;
};

/** Outcome of one rule over today's candidates. */
export type RuleRun = {
  readonly result: RuleResult;
  /** Instruments in scope whose data was missing for a referenced variable. */
  readonly insufficient: readonly { readonly key: InstrumentKey; readonly scope: RuleScope }[];
};

/** Candidates in a rule's scope (portfolio, all watchlists, or both; HLD D28). */
export function candidatesInScope(
  rule: Pick<RuleToRun, 'appliesToPortfolio' | 'appliesToWatchlists'>,
  candidates: readonly RuleCandidate[],
): RuleCandidate[] {
  return candidates.filter((c) =>
    c.scope === 'PORTFOLIO' ? rule.appliesToPortfolio : rule.appliesToWatchlists,
  );
}

/**
 * Daily evaluation (LLD §2.8): every rule against the candidates in its scope. Matches are capped
 * at {@link MAX_RULE_MATCHES} (the stored document limit).
 */
export function evaluateRules(
  rules: readonly RuleToRun[],
  candidates: readonly RuleCandidate[],
  sessionDate: IsoDate,
  evaluatedAt: number,
): RuleRun[] {
  return rules.map((r) => {
    const out = dryRun(r.rule, candidatesInScope(r, candidates));
    return {
      result: {
        schemaVersion: 1,
        ruleId: r.id,
        sessionDate,
        matches: out.matches
          .slice(0, MAX_RULE_MATCHES)
          .map((m) => ({ instrumentKey: m.key, scope: m.scope })),
        evaluatedAt,
      },
      insufficient: out.insufficient,
    };
  });
}

/** True when two results for the same rule and session have the same matches (order ignored). */
export function sameRuleMatches(a: RuleResult, b: RuleResult): boolean {
  if (a.ruleId !== b.ruleId || a.sessionDate !== b.sessionDate) return false;
  if (a.matches.length !== b.matches.length) return false;
  const keys = new Set(a.matches.map((m) => `${m.scope}|${m.instrumentKey}`));
  return b.matches.every((m) => keys.has(`${m.scope}|${m.instrumentKey}`));
}
