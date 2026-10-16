import {
  parseInstrumentKey,
  RULE_VARIABLES,
  type InstrumentKey,
  type Rule,
  type RuleResult,
  type RuleVariable,
  type ValidRule,
} from '@portfolio/core';

/** S08 filter chips. */
export type RulesFilter = 'ALL' | 'PORTFOLIO' | 'WATCHLIST' | 'PAUSED';

/** One rule card on S08. */
export type RuleCardModel = {
  readonly rule: Rule;
  /** `null` = stored logic no longer passes the whitelist (shown as "Needs attention"). */
  readonly valid: ValidRule | null;
  readonly result: RuleResult | null;
  readonly matchedSymbols: readonly string[];
  readonly insufficientCount: number;
};

/** The S08 view model (LLD §4.3 `useRuleSummary`). */
export type RuleSummary = {
  readonly cards: readonly RuleCardModel[];
  readonly active: number;
  readonly paused: number;
  /** Enabled rules with at least one match this session. */
  readonly triggered: number;
  readonly triggeredSymbols: readonly string[];
  readonly counts: Readonly<Record<RulesFilter, number>>;
  readonly lastEvaluatedAt: number | null;
};

const symbolOf = (key: InstrumentKey): string => parseInstrumentKey(key)?.symbol ?? key;

/** Pure summary of rules and today's results (tested). */
export function summariseRules(
  rules: readonly Rule[],
  valid: ReadonlyMap<string, ValidRule | null>,
  results: ReadonlyMap<string, RuleResult>,
  insufficient: ReadonlyMap<string, readonly unknown[]>,
): Omit<RuleSummary, 'lastEvaluatedAt'> {
  const cards = rules.map((rule): RuleCardModel => {
    const result = rule.enabled ? (results.get(rule.id) ?? null) : null;
    return {
      rule,
      valid: valid.get(rule.id) ?? null,
      result,
      matchedSymbols: [...new Set((result?.matches ?? []).map((m) => symbolOf(m.instrumentKey)))],
      insufficientCount: rule.enabled ? (insufficient.get(rule.id)?.length ?? 0) : 0,
    };
  });
  const triggeredCards = cards.filter((c) => c.matchedSymbols.length > 0);
  return {
    cards,
    active: rules.filter((r) => r.enabled).length,
    paused: rules.filter((r) => !r.enabled).length,
    triggered: triggeredCards.length,
    triggeredSymbols: [...new Set(triggeredCards.flatMap((c) => c.matchedSymbols))],
    counts: {
      ALL: rules.length,
      PORTFOLIO: rules.filter((r) => r.appliesToPortfolio).length,
      WATCHLIST: rules.filter((r) => r.appliesToWatchlists).length,
      PAUSED: rules.filter((r) => !r.enabled).length,
    },
  };
}

/** Cards matching an S08 filter chip. */
export function filterRuleCards(cards: readonly RuleCardModel[], f: RulesFilter): RuleCardModel[] {
  switch (f) {
    case 'PORTFOLIO':
      return cards.filter((c) => c.rule.appliesToPortfolio);
    case 'WATCHLIST':
      return cards.filter((c) => c.rule.appliesToWatchlists);
    case 'PAUSED':
      return cards.filter((c) => !c.rule.enabled);
    default:
      return [...cards];
  }
}

/** A piece of read-back text; `variable` pieces are highlighted on S08. */
export type ReadBackPart = { readonly text: string; readonly variable: boolean };

/**
 * Splits a read-back into plain and variable-label parts (longest labels first, so "Previous
 * 50-day moving average" wins over "50-day moving average").
 */
export function splitReadBack(text: string, variables: readonly RuleVariable[]): ReadBackPart[] {
  const labels = [...new Set(variables.map((v) => RULE_VARIABLES[v].label))].sort(
    (a, b) => b.length - a.length,
  );
  if (labels.length === 0) return [{ text, variable: false }];
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  return text
    .split(re)
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, variable: labels.includes(t) }));
}
