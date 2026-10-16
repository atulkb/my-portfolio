import {
  deepAnalysisTask,
  ExchangeSchema,
  filterAlternatives,
  FUNDAMENTAL_PARAMS,
  hashInput,
  LabelSchema,
  marketSentimentTask,
  performanceRatingTask,
  SIGNAL_LABELS,
  signalsTask,
  TECHNICAL_PARAMS,
  type AppError,
  type Clock,
  type DeepAnalysis,
  type DeepAnalysisInput,
  type Exchange,
  type InstrumentKey,
  type IsoDate,
  type KeyValueCache,
  type MacroAssessment,
  type MarketSentiment,
  type MarketSentimentInput,
  type ModelTier,
  type PerformanceInput,
  type PerformanceRating,
  type Signal,
  type SignalInput,
} from '@portfolio/core';
import { z } from 'zod';

import { AI_CONFIG } from '@/config/ai';
import type { AiClient } from './aiClient';
import type { AiUsage } from './usage';

/** A cached AI answer (LLD §3.5 caching, D26). */
export type AiEntry<T> = {
  /** Session of the market data the answer is based on. */
  readonly sessionDate: IsoDate;
  readonly inputHash: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: number;
  readonly value: T;
};

/** MMKV keys (LLD §1.9 as amended by §3.5). */
export const AI_KEYS = {
  performance: 'ai.performance',
  signals: 'ai.signals',
  analysisPrefix: 'ai.analysis.',
  marketSentiment: 'ai.marketSentiment',
} as const;

const entrySchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    sessionDate: z.string(),
    inputHash: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    createdAt: z.number(),
    value,
  });

const PerformanceValue = z.object({ rating: LabelSchema, reason: z.string() });
const SignalValue = z.object({
  label: z.enum(SIGNAL_LABELS),
  confidencePct: z.number(),
  targetEntryPrice: z.number().nullable(),
  reason: z.string(),
});
const ParamKey = z.enum([...TECHNICAL_PARAMS, ...FUNDAMENTAL_PARAMS]);
const DeepAnalysisValue = z.object({
  summary: z.string(),
  pros: z.array(z.object({ paramKey: ParamKey, text: z.string() })),
  cons: z.array(z.object({ paramKey: ParamKey, text: z.string() })),
  risks: z.array(z.string()),
  watchFor: z.array(z.string()),
  alternatives: z.array(z.object({ symbol: z.string(), exchange: ExchangeSchema, reason: z.string() })),
});
const SentimentValue = z.object({ headline: z.string(), paragraph: z.string() });

const PerformanceMapSchema = z.record(z.string(), entrySchema(PerformanceValue));
const SignalMapSchema = z.record(z.string(), entrySchema(SignalValue));
const AnalysisEntrySchema = entrySchema(DeepAnalysisValue);
const SentimentEntrySchema = entrySchema(SentimentValue);

/** One item to rate: its instrument, the session its data comes from, and the task input. */
export type AiItem<I> = { readonly key: InstrumentKey; readonly sessionDate: IsoDate; readonly input: I };

/** Result of a batch task: the full cache map after the run, plus what could not be answered. */
export type AiBatchResult<T> = {
  readonly entries: Readonly<Record<InstrumentKey, AiEntry<T>>>;
  /** Keys sent but without a valid answer (shown as "Not rated" / "No signal" unless an older entry exists). */
  readonly failed: readonly InstrumentKey[];
  readonly error: AppError | null;
  readonly calls: number;
};

/** The four AI tasks of v1 with caching (rule compile joins with M8). */
export type AiService = {
  cachedPerformance(): Record<InstrumentKey, AiEntry<PerformanceRating>>;
  cachedSignals(): Record<InstrumentKey, AiEntry<Signal>>;
  cachedAnalysis(key: InstrumentKey): AiEntry<DeepAnalysis> | null;
  cachedSentiment(): AiEntry<MarketSentiment> | null;
  /** Items whose cached entry is missing or stale (different session, input or prompt version). */
  stalePerformance(items: readonly AiItem<PerformanceInput>[]): AiItem<PerformanceInput>[];
  staleSignals(items: readonly AiItem<SignalInput>[], macro: MacroAssessment): AiItem<SignalInput>[];
  isAnalysisFresh(item: AiItem<DeepAnalysisInput>): boolean;
  isSentimentFresh(sessionDate: IsoDate, input: MarketSentimentInput): boolean;
  /** Rates stale items (all items with `force`). */
  ratePerformance(
    items: readonly AiItem<PerformanceInput>[],
    opts: { force: boolean },
  ): Promise<AiBatchResult<PerformanceRating>>;
  generateSignals(
    items: readonly AiItem<SignalInput>[],
    macro: MacroAssessment,
    opts: { force: boolean },
  ): Promise<AiBatchResult<Signal>>;
  /** Cached when fresh unless `force`; alternatives not in the stock list are dropped. Throws `AppError`. */
  deepAnalysis(
    item: AiItem<DeepAnalysisInput>,
    opts: { force: boolean; exists: (exchange: Exchange, symbol: string) => boolean },
  ): Promise<AiEntry<DeepAnalysis>>;
  /** Throws `AppError`. */
  marketSentiment(
    sessionDate: IsoDate,
    input: MarketSentimentInput,
    opts: { force: boolean },
  ): Promise<AiEntry<MarketSentiment>>;
  /** Drops entries whose data is more than {@link AI_PRUNE_DAYS} days old, and old usage counters. */
  prune(today: IsoDate): void;
  usedToday(): number;
  leftToday(): number;
};

/** Entries older than this many calendar days (≈ 3 sessions incl. a weekend) are pruned (LLD §3.5). */
export const AI_PRUNE_DAYS = 5;

/** Dependencies, injected so tests use a fake client and in-memory cache. */
export type AiServiceDeps = {
  readonly client: AiClient;
  readonly usage: AiUsage;
  readonly kv: KeyValueCache;
  readonly clock: Clock;
};

const daysBefore = (iso: IsoDate, days: number): IsoDate => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Creates the AI service (LLD §3.5). */
export function createAiService(deps: AiServiceDeps): AiService {
  const { client, kv, clock } = deps;
  const perfHash = (i: PerformanceInput): string => hashInput(i);
  const signalHash = (i: SignalInput, macro: MacroAssessment): string => hashInput({ i, macro });

  const fresh = <T>(e: AiEntry<T> | undefined | null, sessionDate: IsoDate, hash: string, version: string) =>
    !!e && e.sessionDate === sessionDate && e.inputHash === hash && e.promptVersion === version;

  const entry = <T>(
    sessionDate: IsoDate,
    inputHash: string,
    model: ModelTier,
    version: string,
    value: T,
  ): AiEntry<T> => ({
    sessionDate,
    inputHash,
    model: AI_CONFIG.models[model],
    promptVersion: version,
    createdAt: clock.now(),
    value,
  });

  const cachedPerformance = (): Record<InstrumentKey, AiEntry<PerformanceRating>> =>
    (kv.get(AI_KEYS.performance, PerformanceMapSchema) ?? {}) as Record<
      InstrumentKey,
      AiEntry<PerformanceRating>
    >;
  const cachedSignals = (): Record<InstrumentKey, AiEntry<Signal>> =>
    (kv.get(AI_KEYS.signals, SignalMapSchema) ?? {}) as Record<InstrumentKey, AiEntry<Signal>>;

  const stalePerformance = (items: readonly AiItem<PerformanceInput>[]) => {
    const cache = cachedPerformance();
    return items.filter(
      (it) => !fresh(cache[it.key], it.sessionDate, perfHash(it.input), performanceRatingTask.version),
    );
  };
  const staleSignals = (items: readonly AiItem<SignalInput>[], macro: MacroAssessment) => {
    const cache = cachedSignals();
    return items.filter(
      (it) => !fresh(cache[it.key], it.sessionDate, signalHash(it.input, macro), signalsTask.version),
    );
  };

  return {
    cachedPerformance,
    cachedSignals,
    cachedAnalysis: (key) => kv.get(`${AI_KEYS.analysisPrefix}${key}`, AnalysisEntrySchema),
    cachedSentiment: () => kv.get(AI_KEYS.marketSentiment, SentimentEntrySchema),
    stalePerformance,
    staleSignals,

    isAnalysisFresh(item) {
      const e = kv.get(`${AI_KEYS.analysisPrefix}${item.key}`, AnalysisEntrySchema);
      return fresh(e, item.sessionDate, hashInput(item.input), deepAnalysisTask.version);
    },

    isSentimentFresh(sessionDate, input) {
      return fresh(
        kv.get(AI_KEYS.marketSentiment, SentimentEntrySchema),
        sessionDate,
        hashInput(input),
        marketSentimentTask.version,
      );
    },

    async ratePerformance(items, { force }) {
      const todo = force ? [...items] : stalePerformance(items);
      if (todo.length === 0) return { entries: cachedPerformance(), failed: [], error: null, calls: 0 };
      const run = await client.runBatch(
        performanceRatingTask,
        todo.map((t) => t.input),
        null,
      );
      const map = cachedPerformance();
      const failed: InstrumentKey[] = [];
      for (const it of todo) {
        const value = run.results.get(it.key);
        if (value)
          map[it.key] = entry(
            it.sessionDate,
            perfHash(it.input),
            performanceRatingTask.model,
            performanceRatingTask.version,
            value,
          );
        else failed.push(it.key);
      }
      kv.set(AI_KEYS.performance, map);
      return { entries: map, failed, error: run.error, calls: run.calls };
    },

    async generateSignals(items, macro, { force }) {
      const todo = force ? [...items] : staleSignals(items, macro);
      if (todo.length === 0) return { entries: cachedSignals(), failed: [], error: null, calls: 0 };
      const run = await client.runBatch(
        signalsTask,
        todo.map((t) => t.input),
        macro,
      );
      const map = cachedSignals();
      const failed: InstrumentKey[] = [];
      for (const it of todo) {
        const value = run.results.get(it.key);
        if (value)
          map[it.key] = entry(
            it.sessionDate,
            signalHash(it.input, macro),
            signalsTask.model,
            signalsTask.version,
            value,
          );
        else failed.push(it.key);
      }
      kv.set(AI_KEYS.signals, map);
      return { entries: map, failed, error: run.error, calls: run.calls };
    },

    async deepAnalysis(item, { force, exists }) {
      const key = `${AI_KEYS.analysisPrefix}${item.key}`;
      const hash = hashInput(item.input);
      const cached = kv.get(key, AnalysisEntrySchema);
      if (!force && cached && fresh(cached, item.sessionDate, hash, deepAnalysisTask.version)) return cached;
      const { value } = await client.runSingle(deepAnalysisTask, item.input);
      const e = entry(
        item.sessionDate,
        hash,
        deepAnalysisTask.model,
        deepAnalysisTask.version,
        filterAlternatives(value, exists),
      );
      kv.set(key, e);
      return e;
    },

    async marketSentiment(sessionDate, input, { force }) {
      const hash = hashInput(input);
      const cached = kv.get(AI_KEYS.marketSentiment, SentimentEntrySchema);
      if (!force && cached && fresh(cached, sessionDate, hash, marketSentimentTask.version)) return cached;
      const { value } = await client.runSingle(marketSentimentTask, input);
      const e = entry(sessionDate, hash, marketSentimentTask.model, marketSentimentTask.version, value);
      kv.set(AI_KEYS.marketSentiment, e);
      return e;
    },

    prune(today) {
      const cutoff = daysBefore(today, AI_PRUNE_DAYS);
      const keep = <T>(m: Record<string, AiEntry<T>>) =>
        Object.fromEntries(Object.entries(m).filter(([, e]) => e.sessionDate >= cutoff));
      kv.set(AI_KEYS.performance, keep(cachedPerformance()));
      kv.set(AI_KEYS.signals, keep(cachedSignals()));
      for (const k of kv.keys(AI_KEYS.analysisPrefix)) {
        const e = kv.get(k, AnalysisEntrySchema);
        if (!e || e.sessionDate < cutoff) kv.delete(k);
      }
      const s = kv.get(AI_KEYS.marketSentiment, SentimentEntrySchema);
      if (s && s.sessionDate < cutoff) kv.delete(AI_KEYS.marketSentiment);
      deps.usage.prune();
    },

    usedToday: () => deps.usage.usedToday(),
    leftToday: () => deps.usage.leftToday(),
  };
}
