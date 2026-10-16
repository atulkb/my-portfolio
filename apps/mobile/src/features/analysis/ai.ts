import {
  assessMacro,
  parseInstrumentKey,
  sessionDateFor,
  toInstrumentKey,
  type DeepAnalysisInput,
  type Exchange,
  type FxContext,
  type InstrumentKey,
  type MacroAssessment,
  type MacroSnapshot,
  type MarketSentimentInput,
  type PerformanceInput,
  type SignalInput,
  type StockHolding,
  type UserProfile,
} from '@portfolio/core';
import { useCallback, useEffect, useMemo } from 'react';

import { FEATURES } from '@/config/features';
import { currentHoldings } from '@/features/portfolio/hooks';
import { latestSessionDate } from '@/lib/dates';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import type { AiItem } from '@/services/ai/aiService';
import {
  aiStore,
  analysisStore,
  marketStore,
  portfolioStore,
  sessionStore,
  useAi,
  useMarket,
  useSession,
  watchlistStore,
} from '@/stores';
import type { AnalysisEntry } from '@/stores/analysisStore';
import { positionBenchmark, type PositionBenchmark } from './hooks';

/** Debounce for the AI sync: lets refresh steps and store updates settle into one batch. */
const AI_SYNC_DEBOUNCE_MS = 1500;
const NO_MACRO: MacroSnapshot = { indiaVix: null, vix: null, nifty: null, sp500: null };

/** Effective AI suggestions (D29): the build flag and the user's setting. */
export function aiSuggestionsOn(profile: UserProfile | null): boolean {
  return FEATURES.aiSuggestions && (profile?.settings.aiSuggestions ?? false);
}

/** React hook for {@link aiSuggestionsOn}. */
export function useAiSuggestions(): boolean {
  return useSession((s) => aiSuggestionsOn(s.profile));
}

/** True when the stock list has this listing (AI alternatives must exist, LLD §3.5). */
export function listingExists(exchange: Exchange, symbol: string): boolean {
  return getInstrumentIndex()?.byKey.has(toInstrumentKey(exchange, symbol)) ?? false;
}

/** Performance-rating input for one holding (ANALYSIS_FRAMEWORK §4.1). */
export function performanceInput(
  h: StockHolding,
  entry: AnalysisEntry,
  bench: PositionBenchmark,
): PerformanceInput {
  return {
    symbol: h.symbol,
    exchange: h.exchange,
    pnlPct: h.pnlPct,
    xirrPct: h.xirrPct,
    benchmark: bench.name,
    benchmarkReturnPct: bench.returnPct,
    excessReturnPp: bench.excessPp,
    holdingDays: h.holdingDays,
    healthScore: entry.analysis.healthScore,
    healthLabel: entry.analysis.healthLabel,
    drawdownPct: entry.indicators.drawdownPct,
    volatilityPct: entry.indicators.volatilityPct,
  };
}

/** Where a signal is for: a holding (with P/L) or a watched stock (with the user's targets). */
export type SignalContext =
  | { readonly scope: 'PORTFOLIO'; readonly pnlPct: number | null }
  | {
      readonly scope: 'WATCHLIST';
      readonly targetEntryPrice: number | null;
      readonly targetExitPrice: number | null;
    };

/** Signal input for one stock (ANALYSIS_FRAMEWORK §7.2). */
export function signalInput(
  stock: { readonly symbol: string; readonly exchange: Exchange },
  entry: AnalysisEntry,
  where: SignalContext,
): SignalInput {
  return {
    symbol: stock.symbol,
    exchange: stock.exchange,
    scope: where.scope,
    healthScore: entry.analysis.healthScore,
    healthLabel: entry.analysis.healthLabel,
    insufficientData: entry.analysis.healthLabel === null,
    params: entry.analysis.params.map((p) => ({ key: p.key, value: p.value, level: p.level })),
    pnlPct: where.scope === 'PORTFOLIO' ? where.pnlPct : null,
    targetEntryPrice: where.scope === 'WATCHLIST' ? where.targetEntryPrice : null,
    targetExitPrice: where.scope === 'WATCHLIST' ? where.targetExitPrice : null,
  };
}

/** USD/INR and its change from the previous ECB rate, for the market note. */
export function usdInrMove(fx: FxContext | null): MarketSentimentInput['usdInr'] {
  if (!fx || !Number.isFinite(fx.usdInr)) return { rate: null, changePct: null };
  const prev = [...fx.history].reverse().find((r) => r.date < fx.asOf);
  return {
    rate: fx.usdInr,
    changePct: prev && prev.rate > 0 ? ((fx.usdInr - prev.rate) / prev.rate) * 100 : null,
  };
}

/** Holdings with prices and analysis, as AI items (session = their price data's session). */
function holdingItems(): {
  perf: AiItem<PerformanceInput>[];
  signals: AiItem<SignalInput>[];
} {
  const m = marketStore.getState();
  const byKey = analysisStore.getState().byKey;
  const perf: AiItem<PerformanceInput>[] = [];
  const signals: AiItem<SignalInput>[] = [];
  for (const h of currentHoldings()) {
    const snap = m.snapshots.get(h.key);
    const entry = byKey.get(h.key);
    if (!snap || !entry || h.pnlPct === null) continue;
    const bench = positionBenchmark(h, m.indexHistory);
    perf.push({ key: h.key, sessionDate: snap.sessionDate, input: performanceInput(h, entry, bench) });
    signals.push({
      key: h.key,
      sessionDate: snap.sessionDate,
      input: signalInput(h, entry, { scope: 'PORTFOLIO', pnlPct: h.pnlPct }),
    });
  }
  return { perf, signals };
}

/**
 * Signal items for watched stocks that are not held (a held stock keeps its portfolio signal).
 * `only` limits them to one list (S07 refresh).
 */
export function watchSignalItems(only?: string): AiItem<SignalInput>[] {
  const m = marketStore.getState();
  const byKey = analysisStore.getState().byKey;
  const held = new Set(
    portfolioStore.getState().transactions.map((t) => toInstrumentKey(t.exchange, t.symbol)),
  );
  const w = watchlistStore.getState();
  const items = new Map<InstrumentKey, AiItem<SignalInput>>();
  for (const l of w.watchlists) {
    if (only && l.id !== only) continue;
    for (const i of w.itemsByList[l.id] ?? []) {
      const key = toInstrumentKey(i.exchange, i.symbol);
      const snap = m.snapshots.get(key);
      const entry = byKey.get(key);
      if (held.has(key) || items.has(key) || !snap || !entry) continue;
      items.set(key, {
        key,
        sessionDate: snap.sessionDate,
        input: signalInput(i, entry, {
          scope: 'WATCHLIST',
          targetEntryPrice: i.targetEntryPrice,
          targetExitPrice: i.targetExitPrice,
        }),
      });
    }
  }
  return [...items.values()];
}

/** Signal items for one list (S07 refresh): held stocks keep their portfolio input. */
export function listSignalItems(listId: string): AiItem<SignalInput>[] {
  const items = watchlistStore.getState().itemsByList[listId] ?? [];
  const keys = new Set(items.map((i) => toInstrumentKey(i.exchange, i.symbol)));
  return [...holdingItems().signals.filter((i) => keys.has(i.key)), ...watchSignalItems(listId)];
}

/** Macro assessment shared by every signal of a run (part of the cache key). */
export function currentMacro(): MacroAssessment {
  return assessMacro(marketStore.getState().macro ?? NO_MACRO);
}

/**
 * Rates holdings whose inputs changed or whose session moved on (LLD §3.8 step 9, D26), and
 * generates signals for holdings and watched stocks when AI suggestions are on. `force` re-runs
 * every item (Settings).
 */
export async function syncAi(force: boolean): Promise<void> {
  if (portfolioStore.getState().loadState !== 'ready') return;
  const { perf, signals } = holdingItems();
  if (watchlistStore.getState().loadState === 'ready') signals.push(...watchSignalItems());
  const ai = aiStore.getState();
  const tasks: Promise<void>[] = [];
  if (perf.length > 0) tasks.push(ai.ratePerformance(perf, { force }));
  if (signals.length > 0 && aiSuggestionsOn(sessionStore.getState().profile))
    tasks.push(ai.generateSignals(signals, currentMacro(), { force }));
  await Promise.all(tasks);
}

/**
 * Keeps AI ratings and signals in step with the data: after each refresh, after portfolio or
 * watchlist edits (only the changed stocks are stale) and when AI suggestions are switched on. Returns the
 * unsubscribe function (call from the signed-in layout).
 */
export function startAiSync(): () => void {
  aiStore.getState().hydrate(sessionDateFor('IN', Date.now()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // A running refresh triggers again when it ends; rating half-loaded data would waste calls.
      if (marketStore.getState().refresh.running) return;
      void syncAi(false);
    }, AI_SYNC_DEBOUNCE_MS);
  };
  const subs = [
    marketStore.subscribe((s, p) => {
      if (s.refresh.running !== p.refresh.running || s.indexHistory !== p.indexHistory) schedule();
    }),
    analysisStore.subscribe((s, p) => {
      if (s.byKey !== p.byKey) schedule();
    }),
    portfolioStore.subscribe((s, p) => {
      if (s.transactions !== p.transactions || s.loadState !== p.loadState) schedule();
    }),
    watchlistStore.subscribe((s, p) => {
      if (s.itemsByList !== p.itemsByList || s.loadState !== p.loadState) schedule();
    }),
    sessionStore.subscribe((s, p) => {
      if (aiSuggestionsOn(s.profile) !== aiSuggestionsOn(p.profile)) schedule();
    }),
  ];
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    subs.forEach((u) => u());
  };
}

/** Inputs for the S04 deep analysis that come from the screen. */
export type DeepAnalysisSources = {
  readonly key: InstrumentKey;
  readonly name: string;
  readonly sector: string | null;
  readonly entry: AnalysisEntry | null;
  readonly holding: StockHolding | null;
  readonly bench: PositionBenchmark | null;
  /** True once prices, fundamentals (or their failure) and the analysis are in. */
  readonly ready: boolean;
  /** Only generated while the AI Verdict tab is visible. */
  readonly visible: boolean;
};

/**
 * S04 AI Verdict: generates the narrative when the tab is shown (cached per session and input;
 * re-opening costs no call) and exposes a forced refresh for the refresh icon.
 */
export function useDeepAnalysis(src: DeepAnalysisSources) {
  const suggestions = useAiSuggestions();
  const sessionDate = useMarket((s) => s.snapshots.get(src.key)?.sessionDate ?? null);
  const entry = useAi((s) => s.analysis.get(src.key) ?? null);
  const load = useAi((s) => s.analysisLoads.get(src.key) ?? null);

  const item = useMemo((): AiItem<DeepAnalysisInput> | null => {
    const parsed = parseInstrumentKey(src.key);
    if (!src.entry || !sessionDate || !parsed) return null;
    const a = src.entry.analysis;
    return {
      key: src.key,
      sessionDate,
      input: {
        symbol: parsed.symbol,
        exchange: parsed.exchange,
        name: src.name,
        sector: src.sector,
        params: a.params.map((p) => ({ key: p.key, group: p.group, value: p.value, level: p.level })),
        healthScore: a.healthScore,
        healthLabel: a.healthLabel,
        macro: a.macro,
        position:
          src.holding && src.bench
            ? {
                pnlPct: src.holding.pnlPct,
                xirrPct: src.holding.xirrPct,
                benchmarkReturnPct: src.bench.returnPct,
                excessReturnPp: src.bench.excessPp,
                holdingDays: src.holding.holdingDays,
              }
            : null,
        allowAlternatives: suggestions,
      },
    };
  }, [src.entry, src.key, src.name, src.sector, src.holding, src.bench, sessionDate, suggestions]);

  useEffect(() => {
    if (!item || !src.ready || !src.visible) return;
    void aiStore.getState().deepAnalysis(item, { force: false, exists: listingExists });
  }, [item, src.ready, src.visible]);

  const refresh = useCallback(() => {
    if (item) void aiStore.getState().deepAnalysis(item, { force: true, exists: listingExists });
  }, [item]);

  return { entry, load, refresh, canRefresh: item !== null && src.ready };
}

/** Market-context note for the macro block (HLD D34); generated once per session while shown. */
export function useMarketSentiment(macro: MacroAssessment | null, visible: boolean) {
  const fx = useMarket((s) => s.fx);
  const running = useMarket((s) => s.refresh.running);
  const entry = useAi((s) => s.marketSentiment);
  const load = useAi((s) => s.sentimentLoad);
  const input = useMemo(
    (): MarketSentimentInput | null => (macro ? { macro, usdInr: usdInrMove(fx) } : null),
    [macro, fx],
  );
  const hasData = !!macro && (macro.nifty.pctVsSma200 !== null || macro.sp500.pctVsSma200 !== null);

  useEffect(() => {
    if (!input || !hasData || !visible || running) return;
    void aiStore.getState().loadMarketSentiment(latestSessionDate(Date.now()), input, { force: false });
  }, [input, hasData, visible, running]);

  return { entry, load };
}
