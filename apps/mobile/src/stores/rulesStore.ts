import {
  addDays,
  evaluateRules,
  MAX_RULES,
  NewRuleSchema,
  parseRuleLogicJson,
  sameRuleMatches,
  toAppError,
  type AppErrorCode,
  type Clock,
  type InstrumentKey,
  type IsoDate,
  type NewRule,
  type Rule,
  type RuleCandidate,
  type RuleCompileInput,
  type RulePatch,
  type RuleRepository,
  type RuleResult,
  type RuleScope,
  type RuleToRun,
  type ValidRule,
} from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { CompiledRule } from '@/services/ai/aiService';

/** Rule results older than this many days are deleted (LLD §1.7). */
export const RULE_RESULTS_KEEP_DAYS = 30;

/** Rules store state (LLD §4.3). Rule writes are optimistic; results are written when changed. */
export type RulesState = {
  readonly rules: readonly Rule[];
  /** Stored logic re-validated on load (defence in depth, LLD §1.7); `null` = no longer valid. */
  readonly valid: ReadonlyMap<string, ValidRule | null>;
  readonly loadState: 'idle' | 'loading' | 'ready' | 'error';
  readonly skipped: number;
  /** Session the results belong to (latest closed session of either market). */
  readonly resultsDate: IsoDate | null;
  /** ruleId → result for {@link resultsDate}. */
  readonly results: ReadonlyMap<string, RuleResult>;
  /** ruleId → instruments in scope with missing data at the last evaluation (not stored). */
  readonly insufficient: ReadonlyMap<string, readonly { key: InstrumentKey; scope: RuleScope }[]>;
  /** When rules were last evaluated in this app session ("Last checked"). */
  readonly lastEvaluatedAt: number | null;
  readonly error: AppErrorCode | null;
  load(sessionDate: IsoDate): Promise<void>;
  /** NL → validated rule via Gemini (S08a dry test). Throws `AppError` (`AI_*`). */
  compile(input: RuleCompileInput): Promise<CompiledRule>;
  /** Saves a new rule (enabled). Returns its ID, or null at the limit / when invalid / on failure. */
  create(rule: NewRule): Promise<string | null>;
  update(id: string, patch: RulePatch): Promise<boolean>;
  toggle(id: string, enabled: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /**
   * Evaluates every enabled, valid rule (LLD §2.8 daily evaluation) and writes the results that
   * changed since the last evaluation of this session (§3.8 step 8).
   */
  evaluateAll(candidates: readonly RuleCandidate[], sessionDate: IsoDate): Promise<void>;
  clearError(): void;
  reset(): void;
};

/** Dependencies, injected so tests use fakes. */
export type RulesDeps = {
  readonly repo: () => RuleRepository | null;
  readonly clock: Clock;
  readonly compile: (input: RuleCompileInput) => Promise<CompiledRule>;
};

const validate = (r: Rule): ValidRule | null => {
  const parsed = parseRuleLogicJson(r.compiledLogicJson);
  return parsed.ok ? parsed.value : null;
};

/** Creates the rules store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createRulesStore(deps: RulesDeps): StoreApi<RulesState> {
  const empty = {
    rules: [],
    valid: new Map(),
    loadState: 'idle',
    skipped: 0,
    resultsDate: null,
    results: new Map(),
    insufficient: new Map(),
    lastEvaluatedAt: null,
    error: null,
  } as const;
  let prunedFor: IsoDate | null = null;
  /** Results whose write failed; re-sent with the next evaluation. */
  const unsaved = new Set<string>();

  return createStore<RulesState>()((set, get) => {
    // ≤ 25 small ASTs: re-validating on every change is cheap.
    const validMap = (rules: readonly Rule[]): Map<string, ValidRule | null> =>
      new Map(rules.map((r) => [r.id, validate(r)]));

    async function optimistic(
      change: (rules: readonly Rule[]) => readonly Rule[],
      write: (repo: RuleRepository) => Promise<unknown>,
    ): Promise<boolean> {
      const repo = deps.repo();
      if (!repo) return false;
      const before = get().rules;
      const next = change(before);
      set({ rules: next, valid: validMap(next), error: null });
      try {
        await write(repo);
        return true;
      } catch (e) {
        const code = toAppError(e).code;
        set({
          rules: before,
          valid: validMap(before),
          error: code === 'APP_UNEXPECTED' ? 'FS_WRITE_FAILED' : code,
        });
        return false;
      }
    }

    return {
      ...empty,

      load: async (sessionDate) => {
        const repo = deps.repo();
        if (!repo) return;
        set({ loadState: 'loading' });
        try {
          const [rules, results] = await Promise.all([repo.list(), repo.listResults(sessionDate)]);
          const sortedRules = [...rules.items].sort((a, b) => a.createdAt - b.createdAt);
          set({
            rules: sortedRules,
            valid: validMap(sortedRules),
            skipped: rules.skipped,
            resultsDate: sessionDate,
            results: new Map(results.items.map((r) => [r.ruleId, r])),
            loadState: 'ready',
          });
        } catch (e) {
          set({ loadState: 'error', error: toAppError(e).code });
        }
      },

      compile: (input) => deps.compile(input),

      create: async (rule) => {
        const repo = deps.repo();
        if (!repo) return null;
        if (get().rules.length >= MAX_RULES) {
          set({ error: 'RULE_LIMIT' });
          return null;
        }
        const parsed = NewRuleSchema.safeParse(rule);
        if (!parsed.success) return null;
        const id = repo.newId();
        const now = deps.clock.now();
        const stored: Rule = { ...parsed.data, id, schemaVersion: 1, createdAt: now, updatedAt: now };
        const ok = await optimistic(
          (rules) => [...rules, stored],
          (r) => r.create(id, parsed.data),
        );
        return ok ? id : null;
      },

      update: (id, patch) => {
        const current = get().rules.find((r) => r.id === id);
        if (!current) return Promise.resolve(false);
        const { id: _id, schemaVersion: _v, createdAt: _c, updatedAt: _u, ...fields } = current;
        const parsed = NewRuleSchema.safeParse({ ...fields, ...patch });
        if (!parsed.success) return Promise.resolve(false);
        const now = deps.clock.now();
        return optimistic(
          (rules) => rules.map((r) => (r.id === id ? { ...r, ...parsed.data, updatedAt: now } : r)),
          (r) => r.update(id, patch),
        );
      },

      toggle: (id, enabled) => get().update(id, { enabled }),

      remove: async (id) => {
        const ok = await optimistic(
          (rules) => rules.filter((r) => r.id !== id),
          (r) => r.delete(id),
        );
        // Its stored results age out with the 30-day prune; drop them from the hub now.
        if (ok)
          set((s) => {
            const results = new Map(s.results);
            results.delete(id);
            return { results };
          });
        return ok;
      },

      evaluateAll: async (candidates, sessionDate) => {
        const repo = deps.repo();
        const s = get();
        if (!repo || s.loadState !== 'ready') return;
        const toRun: RuleToRun[] = [];
        for (const r of s.rules) {
          const v = s.valid.get(r.id);
          if (r.enabled && v)
            toRun.push({
              id: r.id,
              rule: v,
              appliesToPortfolio: r.appliesToPortfolio,
              appliesToWatchlists: r.appliesToWatchlists,
            });
        }
        const now = deps.clock.now();
        const runs = evaluateRules(toRun, candidates, sessionDate, now);
        const prev = s.resultsDate === sessionDate ? s.results : new Map<string, RuleResult>();
        const changed = runs
          .map((x) => x.result)
          .filter((r) => {
            const old = prev.get(r.ruleId);
            return !old || unsaved.has(r.ruleId) || !sameRuleMatches(old, r);
          });
        const results = new Map(prev);
        for (const r of changed) results.set(r.ruleId, r);
        set({
          resultsDate: sessionDate,
          results,
          insufficient: new Map(runs.map((x) => [x.result.ruleId, x.insufficient])),
          lastEvaluatedAt: now,
        });
        if (changed.length > 0) {
          try {
            await repo.saveResults(changed);
            for (const r of changed) unsaved.delete(r.ruleId);
          } catch (e) {
            // Shown from memory meanwhile; the next evaluation writes them again.
            for (const r of changed) unsaved.add(r.ruleId);
            set({ error: toAppError(e).code });
          }
        }
        if (prunedFor !== sessionDate) {
          prunedFor = sessionDate;
          await repo.pruneResultsBefore(addDays(sessionDate, -RULE_RESULTS_KEEP_DAYS)).catch(() => {
            prunedFor = null;
          });
        }
      },

      clearError: () => set({ error: null }),

      reset: () => {
        prunedFor = null;
        unsaved.clear();
        set(empty);
      },
    };
  });
}
