import {
  FundamentalsSchema,
  InstrumentProfileSchema,
  IsoDateSchema,
  type BarsResult,
  type DailyBar,
  type IsoDate,
} from '@portfolio/core';
import { z } from 'zod';

/** MMKV key of an instrument's cached bars (LLD §1.9). */
export const barsKey = (key: string): string => `market.bars.${key}`;

/** Columnar daily bars, ~15 KB per instrument (LLD §3.3 "Cached shapes"). */
export const CachedBarsSchema = z.object({
  v: z.literal(1),
  key: z.string(),
  provider: z.string(),
  currency: z.enum(['INR', 'USD']).nullable(),
  adjusted: z.boolean(),
  sessionDate: IsoDateSchema,
  fetchedAt: z.number(),
  d: z.array(IsoDateSchema),
  o: z.array(z.number()),
  h: z.array(z.number()),
  l: z.array(z.number()),
  c: z.array(z.number()),
  a: z.array(z.number()),
  vol: z.array(z.number()),
});
/** Cached bars of one instrument. */
export type CachedBars = z.infer<typeof CachedBarsSchema>;

/** Packs bars for MMKV; `null` when there are no bars. */
export function toCachedBars(key: string, result: BarsResult, fetchedAt: number): CachedBars | null {
  const last = result.bars.at(-1);
  if (!last) return null;
  return {
    v: 1,
    key,
    provider: result.provider,
    currency: result.currency,
    adjusted: result.adjusted,
    sessionDate: last.date,
    fetchedAt,
    d: result.bars.map((b) => b.date),
    o: result.bars.map((b) => b.open),
    h: result.bars.map((b) => b.high),
    l: result.bars.map((b) => b.low),
    c: result.bars.map((b) => b.close),
    a: result.bars.map((b) => b.adjClose),
    vol: result.bars.map((b) => b.volume),
  };
}

/** Unpacks cached bars (ascending). */
export function fromCachedBars(c: CachedBars): DailyBar[] {
  return c.d.map((date: IsoDate, i) => ({
    date,
    open: c.o[i] ?? 0,
    high: c.h[i] ?? 0,
    low: c.l[i] ?? 0,
    close: c.c[i] ?? 0,
    adjClose: c.a[i] ?? c.c[i] ?? 0,
    volume: c.vol[i] ?? 0,
  }));
}

/** MMKV key of an instrument's cached fundamentals (LLD §1.9, 7-day TTL). */
export const fundamentalsKey = (key: string): string => `market.fundamentals.${key}`;
/** MMKV key of an instrument's cached profile (LLD §1.9, 30-day TTL). */
export const profileKey = (key: string): string => `market.profile.${key}`;
/** MMKV key of a benchmark index's long history (LLD §1.9, extended, never discarded). */
export const indexHistoryKey = (index: BenchmarkIndex): string => `market.index.${index}`;

/** Benchmark indices (LLD §2.5). */
export type BenchmarkIndex = 'NIFTY50' | 'SP500';

/** Cached fundamentals; `null` data is cached too so a stock without data isn't re-asked daily. */
export const CachedFundamentalsSchema = z.object({
  v: z.literal(1),
  key: z.string(),
  fetchedAt: z.number(),
  data: FundamentalsSchema.nullable(),
});
/** Cached fundamentals of one instrument. */
export type CachedFundamentals = z.infer<typeof CachedFundamentalsSchema>;

/** Cached provider profile (sector/industry). */
export const CachedProfileSchema = z.object({
  v: z.literal(1),
  key: z.string(),
  fetchedAt: z.number(),
  profile: InstrumentProfileSchema,
});
/** Cached profile of one instrument. */
export type CachedProfile = z.infer<typeof CachedProfileSchema>;

/** Adjusted-close history of a benchmark index back to the earliest buy (columnar). */
export const CachedIndexHistorySchema = z.object({
  v: z.literal(1),
  index: z.enum(['NIFTY50', 'SP500']),
  /** First date the history was requested from (covers buys on or after it). */
  from: IsoDateSchema,
  fetchedAt: z.number(),
  d: z.array(IsoDateSchema),
  a: z.array(z.number()),
});
/** Cached benchmark history. */
export type CachedIndexHistory = z.infer<typeof CachedIndexHistorySchema>;

/** Index history rows as bars (only `date` and `adjClose` are meaningful). */
export function fromCachedIndexHistory(c: CachedIndexHistory): DailyBar[] {
  return c.d.map((date, i) => {
    const a = c.a[i] ?? 0;
    return { date, open: a, high: a, low: a, close: a, adjClose: a, volume: 0 };
  });
}
