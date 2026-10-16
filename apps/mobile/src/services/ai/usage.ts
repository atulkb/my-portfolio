import { AppError, type Clock, type KeyValueCache } from '@portfolio/core';
import { z } from 'zod';

import { localIsoDate } from '@/lib/dates';

const USAGE_PREFIX = 'ai.usage.';
const CountSchema = z.number().int().nonnegative();
/** Daily counters kept (today plus the two days before), LLD §1.9. */
const KEEP_DAYS = 3;

/** Request budget for Gemini (LLD §3.5 step 1). */
export type AiUsage = {
  /**
   * Reserves one request: waits for a free per-minute slot (up to `maxWaitMs`), then counts it
   * against the day. Throws `AI_BUDGET_EXCEEDED` when the daily cap is reached or the wait is too long.
   */
  acquire(): Promise<void>;
  /** Requests made today (local day). */
  usedToday(): number;
  /** Requests left today. */
  leftToday(): number;
  /** Removes counters older than {@link KEEP_DAYS} days. */
  prune(): void;
};

/** Dependencies, injected so tests use fake time. */
export type AiUsageDeps = {
  readonly kv: KeyValueCache;
  readonly clock: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  readonly limits: { readonly rpm: number; readonly dailyCap: number; readonly maxWaitMs: number };
};

/** Creates the budget: per-day count in MMKV `ai.usage.<YYYY-MM-DD>`, per-minute window in memory. */
export function createAiUsage(deps: AiUsageDeps): AiUsage {
  const { kv, clock, limits } = deps;
  const recent: number[] = [];
  const dayKey = (): string => `${USAGE_PREFIX}${localIsoDate(new Date(clock.now()))}`;
  const usedToday = (): number => kv.get(dayKey(), CountSchema) ?? 0;

  return {
    async acquire() {
      const started = clock.now();
      for (;;) {
        if (usedToday() >= limits.dailyCap) throw new AppError('AI_BUDGET_EXCEEDED');
        const now = clock.now();
        while (recent.length > 0 && (recent[0] ?? 0) <= now - 60_000) recent.shift();
        if (recent.length < limits.rpm) {
          recent.push(now);
          kv.set(dayKey(), usedToday() + 1);
          return;
        }
        const wait = (recent[0] ?? now) + 60_000 - now;
        if (now + wait - started > limits.maxWaitMs) throw new AppError('AI_BUDGET_EXCEEDED');
        await deps.sleep(wait);
      }
    },
    usedToday,
    leftToday: () => Math.max(0, limits.dailyCap - usedToday()),
    prune() {
      const oldest = new Date(clock.now());
      oldest.setDate(oldest.getDate() - (KEEP_DAYS - 1));
      const cutoff = `${USAGE_PREFIX}${localIsoDate(oldest)}`;
      for (const key of kv.keys(USAGE_PREFIX)) if (key < cutoff) kv.delete(key);
    },
  };
}
