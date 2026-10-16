import { IsoDateSchema, type BarsResult, type DailyBar, type IsoDate } from '@portfolio/core';
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
