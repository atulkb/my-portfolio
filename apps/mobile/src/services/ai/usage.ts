import { AppError, dateInTimeZone, type Clock, type KeyValueCache } from '@portfolio/core';
import { z } from 'zod';

const USAGE_PREFIX = 'ai.usage.';
const COOLDOWN_KEY = 'ai.cooldown';
/** Per model: requests sent on the quota day. */
const DayCountsSchema = z.record(z.string(), z.number().int().nonnegative());
/** Per model: epoch ms until which it is skipped after a 429. */
const CooldownSchema = z.record(z.string(), z.number());
/** Daily counters kept (today plus the two days before), LLD §1.9. */
const KEEP_DAYS = 3;

/** One model of the chain with its free-tier requests-per-day quota (HLD D36). */
export type QuotaModel = { readonly id: string; readonly dailyLimit: number };

/** Request budget for Gemini across the model chain (LLD §3.5 step 1, HLD D36). */
export type AiUsage = {
  /**
   * Waits for a free per-minute slot (up to `maxWaitMs`), then reserves one request on the best
   * model with quota left and returns its ID. Throws `AI_BUDGET_EXCEEDED` when every model is
   * used up, cooling down or unavailable, or the wait would be too long.
   */
  acquire(): Promise<string>;
  /** A 429 from `model`: skip it for the cooldown (its quota may be gone before our count says so). */
  rateLimited(model: string): void;
  /** `model` doesn't exist for this project (404): skip it until the app restarts. */
  unavailable(model: string): void;
  /** Requests made today (quota day), all models. */
  usedToday(): number;
  /** Requests left today on models that can still be used. */
  leftToday(): number;
  /** Sum of the daily limits of the whole chain. */
  dailyTotal(): number;
  /** The model the next request would use, or `null` when none is left. */
  currentModel(): string | null;
  /** Removes counters older than {@link KEEP_DAYS} days. */
  prune(): void;
};

/** Dependencies, injected so tests use fake time. */
export type AiUsageDeps = {
  readonly kv: KeyValueCache;
  readonly clock: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  readonly models: readonly QuotaModel[];
  /** Time zone of the quota day (Gemini: America/Los_Angeles). */
  readonly timeZone: string;
  readonly limits: { readonly rpm: number; readonly maxWaitMs: number; readonly cooldownMs: number };
};

/**
 * Creates the budget: per-model counts in MMKV `ai.usage.<quota day>`, cooldowns in
 * `ai.cooldown`, the per-minute window and unavailable models in memory.
 */
export function createAiUsage(deps: AiUsageDeps): AiUsage {
  const { kv, clock, limits } = deps;
  const recent: number[] = [];
  const missing = new Set<string>();
  const day = (): string => dateInTimeZone(deps.timeZone, clock.now());
  const dayKey = (): string => `${USAGE_PREFIX}${day()}`;
  const counts = (): Record<string, number> => kv.get(dayKey(), DayCountsSchema) ?? {};
  const cooldowns = (): Record<string, number> => kv.get(COOLDOWN_KEY, CooldownSchema) ?? {};

  const usable = (m: QuotaModel, c: Record<string, number>, cool: Record<string, number>): boolean =>
    !missing.has(m.id) && (c[m.id] ?? 0) < m.dailyLimit && (cool[m.id] ?? 0) <= clock.now();

  function pick(): QuotaModel | null {
    const c = counts();
    const cool = cooldowns();
    return deps.models.find((m) => usable(m, c, cool)) ?? null;
  }

  return {
    async acquire() {
      const started = clock.now();
      for (;;) {
        const model = pick();
        if (!model) throw new AppError('AI_BUDGET_EXCEEDED');
        const now = clock.now();
        while (recent.length > 0 && (recent[0] ?? 0) <= now - 60_000) recent.shift();
        if (recent.length < limits.rpm) {
          recent.push(now);
          const c = counts();
          kv.set(dayKey(), { ...c, [model.id]: (c[model.id] ?? 0) + 1 });
          return model.id;
        }
        const wait = (recent[0] ?? now) + 60_000 - now;
        if (now + wait - started > limits.maxWaitMs) throw new AppError('AI_BUDGET_EXCEEDED');
        await deps.sleep(wait);
      }
    },
    rateLimited(model) {
      kv.set(COOLDOWN_KEY, { ...cooldowns(), [model]: clock.now() + limits.cooldownMs });
    },
    unavailable(model) {
      missing.add(model);
    },
    usedToday: () => Object.values(counts()).reduce((a, b) => a + b, 0),
    leftToday() {
      const c = counts();
      const cool = cooldowns();
      return deps.models
        .filter((m) => usable(m, c, cool))
        .reduce((sum, m) => sum + m.dailyLimit - (c[m.id] ?? 0), 0);
    },
    dailyTotal: () => deps.models.reduce((sum, m) => sum + m.dailyLimit, 0),
    currentModel: () => pick()?.id ?? null,
    prune() {
      const now = clock.now();
      const cutoff = `${USAGE_PREFIX}${dateInTimeZone(deps.timeZone, now - (KEEP_DAYS - 1) * 86_400_000)}`;
      for (const key of kv.keys(USAGE_PREFIX)) if (key < cutoff) kv.delete(key);
      const cool = cooldowns();
      const active = Object.fromEntries(Object.entries(cool).filter(([, until]) => until > now));
      if (Object.keys(active).length !== Object.keys(cool).length) kv.set(COOLDOWN_KEY, active);
    },
  };
}
