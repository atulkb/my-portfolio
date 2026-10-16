import type { InstrumentKey, RuleCandidate } from '@portfolio/core';

import { currentHoldings } from '@/features/portfolio/hooks';
import { latestSessionDate } from '@/lib/dates';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import {
  aiStore,
  analysisStore,
  marketStore,
  portfolioStore,
  rulesStore,
  sessionStore,
  watchlistStore,
} from '@/stores';
import { buildRuleCandidates } from './candidates';

/** Lets refresh steps and store updates settle into one evaluation. */
const RULE_SYNC_DEBOUNCE_MS = 1500;

/** Rule candidates from the current store state (`only` = one instrument, for S04). */
export function currentRuleCandidates(only?: InstrumentKey): RuleCandidate[] {
  const m = marketStore.getState();
  const w = watchlistStore.getState();
  return buildRuleCandidates(
    {
      holdings: currentHoldings(),
      watchItems: w.watchlists.flatMap((l) => w.itemsByList[l.id] ?? []),
      analysis: analysisStore.getState().byKey,
      market: m,
      sector: {
        overrides: sessionStore.getState().profile?.sectorOverrides,
        profiles: m.profiles,
        index: getInstrumentIndex(),
      },
    },
    only,
  );
}

/** True once everything rules read from has loaded and at least one refresh has finished. */
function readyToEvaluate(): boolean {
  const m = marketStore.getState();
  return (
    rulesStore.getState().loadState === 'ready' &&
    portfolioStore.getState().loadState === 'ready' &&
    watchlistStore.getState().loadState === 'ready' &&
    m.refresh.lastAt !== null &&
    !m.refresh.running
  );
}

/** Evaluates every enabled rule now (LLD §3.8 step 8). */
export function evaluateRulesNow(): Promise<void> {
  if (!readyToEvaluate()) return Promise.resolve();
  return rulesStore.getState().evaluateAll(currentRuleCandidates(), latestSessionDate(Date.now()));
}

/**
 * Loads rules and today's results, then re-evaluates after each refresh and whenever rules,
 * holdings, watchlists, Health or Performance labels change. Results are written only when they
 * changed (rules store). Returns the unsubscribe function (call from the signed-in layout).
 */
export function startRuleSync(): () => void {
  void rulesStore.getState().load(latestSessionDate(Date.now()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void evaluateRulesNow();
    }, RULE_SYNC_DEBOUNCE_MS);
  };
  const subs = [
    marketStore.subscribe((s, p) => {
      if (s.refresh.running !== p.refresh.running) schedule();
    }),
    analysisStore.subscribe((s, p) => {
      if (s.byKey !== p.byKey) schedule();
    }),
    aiStore.subscribe((s, p) => {
      if (s.performance !== p.performance) schedule();
    }),
    portfolioStore.subscribe((s, p) => {
      if (s.transactions !== p.transactions || s.loadState !== p.loadState) schedule();
    }),
    watchlistStore.subscribe((s, p) => {
      if (s.itemsByList !== p.itemsByList || s.loadState !== p.loadState) schedule();
    }),
    rulesStore.subscribe((s, p) => {
      if (s.rules !== p.rules || s.loadState !== p.loadState) schedule();
    }),
  ];
  return () => {
    if (timer) clearTimeout(timer);
    subs.forEach((u) => u());
  };
}
