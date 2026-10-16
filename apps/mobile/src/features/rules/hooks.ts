import { candidatesInScope, dryRun, type InstrumentKey, type Rule, type RuleOutcome } from '@portfolio/core';
import { useMemo } from 'react';

import { useHoldings } from '@/features/portfolio/hooks';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { useAnalysis, useInstruments, useMarket, useRules, useSession, useWatchlists } from '@/stores';
import { buildRuleCandidates } from './candidates';
import { summariseRules, type RuleSummary } from './summary';

export { filterRuleCards, splitReadBack, type RuleCardModel, type RulesFilter } from './summary';

/** S08 summary from the rules store. */
export function useRuleSummary(): RuleSummary {
  const rules = useRules((s) => s.rules);
  const valid = useRules((s) => s.valid);
  const results = useRules((s) => s.results);
  const insufficient = useRules((s) => s.insufficient);
  const lastEvaluatedAt = useRules((s) => s.lastEvaluatedAt);
  return useMemo(
    () => ({ ...summariseRules(rules, valid, results, insufficient), lastEvaluatedAt }),
    [rules, valid, results, insufficient, lastEvaluatedAt],
  );
}

/** One rule's live outcome for an instrument on S04's Rules tab. */
export type InstrumentRuleRow = {
  readonly rule: Rule;
  readonly outcome: RuleOutcome | 'INVALID';
};

/**
 * S04 Rules tab (LLD §4.4): enabled rules whose scope covers this instrument (held → portfolio
 * rules, watched → watchlist rules), each evaluated live on today's data.
 */
export function useInstrumentRules(key: InstrumentKey): {
  readonly rows: readonly InstrumentRuleRow[];
  readonly inScope: boolean;
} {
  const rules = useRules((s) => s.rules);
  const valid = useRules((s) => s.valid);
  const holdings = useHoldings();
  const watchlists = useWatchlists((s) => s.watchlists);
  const itemsByList = useWatchlists((s) => s.itemsByList);
  const analysis = useAnalysis((s) => s.byKey);
  const fundamentals = useMarket((s) => s.fundamentals);
  const macro = useMarket((s) => s.macro);
  const profiles = useMarket((s) => s.profiles);
  const overrides = useSession((s) => s.profile?.sectorOverrides);
  const listVersion = useInstruments((s) => s.meta?.version);
  return useMemo(() => {
    const candidates = buildRuleCandidates(
      {
        holdings,
        watchItems: watchlists.flatMap((l) => itemsByList[l.id] ?? []),
        analysis,
        market: { fundamentals, macro },
        sector: { overrides, profiles, index: listVersion ? getInstrumentIndex() : null },
      },
      key,
    );
    const rows: InstrumentRuleRow[] = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const scoped = candidatesInScope(rule, candidates);
      if (scoped.length === 0) continue;
      const v = valid.get(rule.id);
      if (!v) {
        rows.push({ rule, outcome: 'INVALID' });
        continue;
      }
      const out = dryRun(v, scoped);
      rows.push({
        rule,
        outcome:
          out.matches.length > 0 ? 'MATCH' : out.insufficient.length > 0 ? 'INSUFFICIENT_DATA' : 'NO_MATCH',
      });
    }
    return { rows, inScope: candidates.length > 0 };
  }, [
    key,
    rules,
    valid,
    holdings,
    watchlists,
    itemsByList,
    analysis,
    fundamentals,
    macro,
    profiles,
    overrides,
    listVersion,
  ]);
}
