import {
  hashInput,
  toAppError,
  type AppErrorCode,
  type DeepAnalysis,
  type DeepAnalysisInput,
  type Exchange,
  type InstrumentKey,
  type IsoDate,
  type MacroAssessment,
  type MarketSentiment,
  type MarketSentimentInput,
  type PerformanceInput,
  type PerformanceRating,
  type Signal,
  type SignalInput,
} from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AiEntry, AiItem, AiService } from '@/services/ai/aiService';

/** Progress of one AI task. */
export type AiTaskStatus = {
  readonly running: boolean;
  /** Error of the last run (partial failures leave older entries in place). */
  readonly failure: AppErrorCode | null;
  readonly lastAt: number | null;
};

/** Deep-analysis progress for one instrument. */
export type AiLoad = { readonly state: 'loading' | 'error'; readonly failure: AppErrorCode | null };

/** AI store state (LLD §4.3 `aiStore`): cached entries from MMKV plus task status. */
export type AiState = {
  readonly performance: Readonly<Record<InstrumentKey, AiEntry<PerformanceRating>>>;
  readonly signals: Readonly<Record<InstrumentKey, AiEntry<Signal>>>;
  readonly analysis: ReadonlyMap<InstrumentKey, AiEntry<DeepAnalysis>>;
  readonly analysisLoads: ReadonlyMap<InstrumentKey, AiLoad>;
  readonly marketSentiment: AiEntry<MarketSentiment> | null;
  readonly sentimentLoad: AiLoad | null;
  readonly status: { readonly performance: AiTaskStatus; readonly signals: AiTaskStatus };
  readonly budgetLeftToday: number;
  /** Prunes old entries and loads the caches (app start, after sign-in). */
  hydrate(today: IsoDate): void;
  /** Rates stale holdings (all with `force`); a call while one runs is queued, not dropped. */
  ratePerformance(items: readonly AiItem<PerformanceInput>[], opts: { force: boolean }): Promise<void>;
  generateSignals(
    items: readonly AiItem<SignalInput>[],
    macro: MacroAssessment,
    opts: { force: boolean },
  ): Promise<void>;
  deepAnalysis(
    item: AiItem<DeepAnalysisInput>,
    opts: { force: boolean; exists: (exchange: Exchange, symbol: string) => boolean },
  ): Promise<void>;
  /** Market-context note (cached per session + input); a failed run is not retried until `force`. */
  loadMarketSentiment(
    sessionDate: IsoDate,
    input: MarketSentimentInput,
    opts: { force: boolean },
  ): Promise<void>;
  /** Re-reads the requests left today (after a call made outside this store, e.g. rule compile). */
  refreshBudget(): void;
  reset(): void;
};

/** Dependencies, injected so tests use a fake service. */
export type AiStoreDeps = {
  readonly service: AiService;
  readonly now: () => number;
  /** Shown once per session for budget / rate-limit / not-authorised errors (toast). */
  readonly onNotice?: (code: AppErrorCode) => void;
};

/** Codes surfaced as a toast once per session (LLD §5.2). */
const NOTICE_CODES: ReadonlySet<AppErrorCode> = new Set([
  'AI_BUDGET_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_NOT_AUTHORISED',
]);

const IDLE: AiTaskStatus = { running: false, failure: null, lastAt: null };

/** Creates the AI store. */
export function createAiStore(deps: AiStoreDeps): StoreApi<AiState> {
  const { service } = deps;
  const noticed = new Set<AppErrorCode>();
  /** Inputs that already failed this session (key → hash): not re-sent until they change or `force`. */
  const failedPerf = new Map<InstrumentKey, string>();
  const failedSignals = new Map<InstrumentKey, string>();
  const inflightAnalysis = new Map<InstrumentKey, Promise<void>>();
  let inflightSentiment: Promise<void> | null = null;

  const notice = (code: AppErrorCode | null | undefined): void => {
    if (!code || !NOTICE_CODES.has(code) || noticed.has(code)) return;
    noticed.add(code);
    deps.onNotice?.(code);
  };

  /** One batch task at a time; the latest queued request runs after the current one. */
  function serial<A extends unknown[]>(run: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
    let current: Promise<void> | null = null;
    let queued: A | null = null;
    const loop = async (args: A): Promise<void> => {
      let next: A | null = args;
      while (next) {
        const a: A = next;
        queued = null;
        await run(...a);
        next = queued;
      }
      current = null;
    };
    return (...args: A) => {
      if (current) {
        queued = args;
        return current;
      }
      current = loop(args);
      return current;
    };
  }

  return createStore<AiState>()((set, get) => {
    const setStatus = (task: 'performance' | 'signals', patch: Partial<AiTaskStatus>): void =>
      set((s) => ({ status: { ...s.status, [task]: { ...s.status[task], ...patch } } }));

    const ratePerformance = serial(async (items: readonly AiItem<PerformanceInput>[], force: boolean) => {
      const todo = force ? items : items.filter((i) => failedPerf.get(i.key) !== hashInput(i.input));
      if (!force && service.stalePerformance(todo).length === 0) return;
      setStatus('performance', { running: true });
      try {
        const res = await service.ratePerformance(todo, { force });
        const byKey = new Map(todo.map((i) => [i.key, i]));
        for (const k of res.failed) {
          const it = byKey.get(k);
          if (it) failedPerf.set(k, hashInput(it.input));
        }
        for (const k of Object.keys(res.entries)) failedPerf.delete(k as InstrumentKey);
        notice(res.error?.code);
        set({ performance: res.entries, budgetLeftToday: service.leftToday() });
        setStatus('performance', { running: false, failure: res.error?.code ?? null, lastAt: deps.now() });
      } catch (e) {
        const code = toAppError(e).code;
        notice(code);
        setStatus('performance', { running: false, failure: code });
      }
    });

    const generateSignals = serial(
      async (items: readonly AiItem<SignalInput>[], macro: MacroAssessment, force: boolean) => {
        const todo = force
          ? items
          : items.filter((i) => failedSignals.get(i.key) !== hashInput({ i: i.input, macro }));
        if (!force && service.staleSignals(todo, macro).length === 0) return;
        setStatus('signals', { running: true });
        try {
          const res = await service.generateSignals(todo, macro, { force });
          const byKey = new Map(todo.map((i) => [i.key, i]));
          for (const k of res.failed) {
            const it = byKey.get(k);
            if (it) failedSignals.set(k, hashInput({ i: it.input, macro }));
          }
          notice(res.error?.code);
          set({ signals: res.entries, budgetLeftToday: service.leftToday() });
          setStatus('signals', { running: false, failure: res.error?.code ?? null, lastAt: deps.now() });
        } catch (e) {
          const code = toAppError(e).code;
          notice(code);
          setStatus('signals', { running: false, failure: code });
        }
      },
    );

    const setLoad = (key: InstrumentKey, load: AiLoad | null): void =>
      set((s) => {
        const next = new Map(s.analysisLoads);
        if (load) next.set(key, load);
        else next.delete(key);
        return { analysisLoads: next };
      });

    return {
      performance: {},
      signals: {},
      analysis: new Map(),
      analysisLoads: new Map(),
      marketSentiment: null,
      sentimentLoad: null,
      status: { performance: IDLE, signals: IDLE },
      budgetLeftToday: 0,

      hydrate: (today) => {
        service.prune(today);
        set({
          performance: service.cachedPerformance(),
          signals: service.cachedSignals(),
          marketSentiment: service.cachedSentiment(),
          budgetLeftToday: service.leftToday(),
        });
      },

      ratePerformance: (items, { force }) => ratePerformance(items, force),
      generateSignals: (items, macro, { force }) => generateSignals(items, macro, force),

      deepAnalysis: (item, opts) => {
        const running = inflightAnalysis.get(item.key);
        if (running && !opts.force) return running;
        const cached = get().analysis.get(item.key) ?? service.cachedAnalysis(item.key);
        if (cached && !get().analysis.has(item.key))
          set((s) => ({ analysis: new Map(s.analysis).set(item.key, cached) }));
        if (!opts.force && service.isAnalysisFresh(item)) return Promise.resolve();
        // A failed run waits for the refresh icon instead of retrying on every render.
        if (!opts.force && get().analysisLoads.get(item.key)?.state === 'error') return Promise.resolve();
        const p = (async () => {
          setLoad(item.key, { state: 'loading', failure: null });
          try {
            const e = await service.deepAnalysis(item, opts);
            set((s) => ({
              analysis: new Map(s.analysis).set(item.key, e),
              budgetLeftToday: service.leftToday(),
            }));
            setLoad(item.key, null);
          } catch (err) {
            const code = toAppError(err).code;
            notice(code);
            setLoad(item.key, { state: 'error', failure: code });
          } finally {
            inflightAnalysis.delete(item.key);
          }
        })();
        inflightAnalysis.set(item.key, p);
        return p;
      },

      loadMarketSentiment: (sessionDate, input, { force }) => {
        if (inflightSentiment && !force) return inflightSentiment;
        if (!force && service.isSentimentFresh(sessionDate, input)) return Promise.resolve();
        if (!force && get().sentimentLoad?.state === 'error') return Promise.resolve();
        inflightSentiment = (async () => {
          set({ sentimentLoad: { state: 'loading', failure: null } });
          try {
            const e = await service.marketSentiment(sessionDate, input, { force });
            set({ marketSentiment: e, sentimentLoad: null, budgetLeftToday: service.leftToday() });
          } catch (err) {
            const code = toAppError(err).code;
            notice(code);
            set({ sentimentLoad: { state: 'error', failure: code } });
          } finally {
            inflightSentiment = null;
          }
        })();
        return inflightSentiment;
      },

      refreshBudget: () => set({ budgetLeftToday: service.leftToday() }),

      reset: () => {
        noticed.clear();
        failedPerf.clear();
        failedSignals.clear();
        set({
          performance: {},
          signals: {},
          analysis: new Map(),
          analysisLoads: new Map(),
          marketSentiment: null,
          sentimentLoad: null,
          status: { performance: IDLE, signals: IDLE },
          budgetLeftToday: 0,
        });
      },
    };
  });
}
