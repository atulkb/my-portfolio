import { defaultMethods, LogicEngine } from 'json-logic-engine';
import type { InstrumentKey } from '../models/primitives';
import { RULE_OPERATORS, type ValidRule } from './validate';
import type { RuleScope, RuleVariable } from './variables';

/** Values available to a rule for one instrument (`null` = missing data). */
export type RuleContext = Readonly<Record<RuleVariable, number | string | null>>;

/** Evaluation outcome; missing data is never silently true or false. */
export type RuleOutcome = 'MATCH' | 'NO_MATCH' | 'INSUFFICIENT_DATA';

type MethodTable = Record<string, unknown>;

function buildEngine(): LogicEngine {
  const table = defaultMethods as unknown as MethodTable;
  const methods: MethodTable = {};
  // Only whitelisted operators (plus `var`) are registered: defence in depth behind validation.
  for (const op of [...RULE_OPERATORS, 'var']) methods[op] = table[op];
  return new LogicEngine(methods);
}

let engine: LogicEngine | null = null;

/**
 * Evaluates a validated rule (LLD §2.8). If any referenced variable is `null` the result is
 * INSUFFICIENT_DATA; otherwise truthy → MATCH. An engine error (should not happen after
 * validation) is reported as INSUFFICIENT_DATA rather than a guess.
 */
export function evaluateRule(rule: ValidRule, ctx: RuleContext): RuleOutcome {
  if (rule.variables.some((v) => ctx[v] === null || ctx[v] === undefined)) return 'INSUFFICIENT_DATA';
  engine ??= buildEngine();
  try {
    return engine.run(rule.json, ctx) ? 'MATCH' : 'NO_MATCH';
  } catch {
    return 'INSUFFICIENT_DATA';
  }
}

/** One instrument to test in a dry run or daily evaluation. */
export type RuleCandidate = {
  readonly key: InstrumentKey;
  readonly scope: RuleScope;
  readonly ctx: RuleContext;
};

/** Dry-run / daily evaluation result (S08a "Run Dry Test"). */
export type DryRunResult = {
  readonly matches: readonly { key: InstrumentKey; scope: RuleScope }[];
  readonly insufficient: readonly { key: InstrumentKey; scope: RuleScope }[];
};

/** Evaluates a rule against every candidate; nothing is saved. */
export function dryRun(rule: ValidRule, candidates: readonly RuleCandidate[]): DryRunResult {
  const matches: { key: InstrumentKey; scope: RuleScope }[] = [];
  const insufficient: { key: InstrumentKey; scope: RuleScope }[] = [];
  for (const c of candidates) {
    const outcome = evaluateRule(rule, c.ctx);
    if (outcome === 'MATCH') matches.push({ key: c.key, scope: c.scope });
    else if (outcome === 'INSUFFICIENT_DATA') insufficient.push({ key: c.key, scope: c.scope });
  }
  return { matches, insufficient };
}
