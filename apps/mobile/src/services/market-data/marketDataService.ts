import {
  addDays,
  EXCHANGE_META,
  isMarketClosed,
  sessionDateFor,
  type AppErrorCode,
  type BarsResult,
  type Clock,
  type DailyBar,
  type Fundamentals,
  type IndexKey,
  type InstrumentKey,
  type InstrumentProfile,
  type InstrumentRef,
  type IsoDate,
  type KeyValueCache,
  type MarketDataProvider,
  type MarketSnapshot,
} from '@portfolio/core';
import { z } from 'zod';

import { isServiceError, toMarketErrorCode } from '../http/errors';
import {
  barsKey,
  CachedBarsSchema,
  CachedFundamentalsSchema,
  CachedIndexHistorySchema,
  CachedProfileSchema,
  fromCachedBars,
  fromCachedIndexHistory,
  fundamentalsKey,
  indexHistoryKey,
  profileKey,
  toCachedBars,
  type BenchmarkIndex,
  type CachedBars,
  type CachedIndexHistory,
} from './cache';

/** A scraped latest close, kept until bars for that session arrive (LLD §3.3, HLD D33). */
const ScrapedCloseSchema = z.object({
  sessionDate: z.string(),
  close: z.number().positive(),
  fetchedAt: z.number(),
});
type ScrapedClose = z.infer<typeof ScrapedCloseSchema>;
const scrapeKey = (key: string): string => `market.scrape.${key}`;

/** A snapshot plus where it came from (LLD §3.3). */
export type PricedSnapshot = MarketSnapshot & {
  /** Older than the expected session for its market (provider down or exchange holiday). */
  readonly stale: boolean;
  readonly provider: string;
  /** 'SCRAPE' = latest close from the quote page; indicators stay on the bars. */
  readonly priceSource: 'BARS' | 'SCRAPE';
  readonly indicatorsAsOf: IsoDate;
};

/** An instrument that could not be priced (no cache either). */
export type SnapshotFailure = { readonly key: InstrumentKey; readonly code: AppErrorCode };

/** Result of {@link MarketDataService.getSnapshots}. */
export type SnapshotsResult = {
  readonly snapshots: ReadonlyMap<InstrumentKey, PricedSnapshot>;
  readonly failures: readonly SnapshotFailure[];
  /** Instruments fetched from the network this time (others came from cache). */
  readonly fetched: number;
};

/** Market data used by the refresh pipeline (LLD §3.3). */
export type MarketDataService = {
  /** Cached snapshots only (no network): the instant render at app start. */
  cachedSnapshots(refs: readonly InstrumentRef[]): ReadonlyMap<InstrumentKey, PricedSnapshot>;
  getSnapshots(
    refs: readonly InstrumentRef[],
    opts: { readonly force: boolean; readonly onProgress?: (done: number, total: number) => void },
  ): Promise<SnapshotsResult>;
  /** Cached fundamentals (any age); instruments never fetched are absent. */
  cachedFundamentals(refs: readonly InstrumentRef[]): ReadonlyMap<InstrumentKey, Fundamentals | null>;
  /** Fundamentals, refetched when older than {@link FUNDAMENTALS_TTL_MS}; `null` = no data. */
  getFundamentals(refs: readonly InstrumentRef[]): Promise<ReadonlyMap<InstrumentKey, Fundamentals | null>>;
  /** Cached profiles (any age). ETFs get sector "ETF" without a network call. */
  cachedProfiles(refs: readonly InstrumentRef[]): ReadonlyMap<InstrumentKey, InstrumentProfile>;
  /** Profiles, refetched when older than {@link PROFILE_TTL_MS}. */
  getProfiles(refs: readonly InstrumentRef[]): Promise<ReadonlyMap<InstrumentKey, InstrumentProfile>>;
  /** Cached benchmark history extended by the cached index bars; `null` if never fetched. */
  cachedIndexHistory(index: BenchmarkIndex): readonly DailyBar[] | null;
  /**
   * Adjusted-close history of a benchmark index from `from` (minus a week) to the latest
   * session. Fetched once, then extended from the index's daily bars (LLD §3.3).
   */
  getIndexHistory(index: BenchmarkIndex, from: IsoDate): Promise<readonly DailyBar[]>;
};

/** Don't re-ask a provider for a session it didn't have (e.g. exchange holiday) more often than this. */
export const STALE_RETRY_MS = 30 * 60 * 1000;
/** Fundamentals cache lifetime (LLD §3.3). */
export const FUNDAMENTALS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Profile cache lifetime (LLD §3.3). */
export const PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Index refs: their daily bars (fetched with the holdings) extend each benchmark history. */
export const INDEX_REFS: Readonly<Record<IndexKey, InstrumentRef>> = {
  'INDEX:NIFTY50': { key: 'INDEX:NIFTY50', symbol: 'NIFTY50', exchange: null, bseCode: null, type: 'INDEX' },
  'INDEX:SP500': { key: 'INDEX:SP500', symbol: 'SP500', exchange: null, bseCode: null, type: 'INDEX' },
  'INDEX:INDIAVIX': {
    key: 'INDEX:INDIAVIX',
    symbol: 'INDIAVIX',
    exchange: null,
    bseCode: null,
    type: 'INDEX',
  },
  'INDEX:VIX': { key: 'INDEX:VIX', symbol: 'VIX', exchange: null, bseCode: null, type: 'INDEX' },
};
const BENCHMARK_KEY: Readonly<Record<BenchmarkIndex, IndexKey>> = {
  NIFTY50: 'INDEX:NIFTY50',
  SP500: 'INDEX:SP500',
};

/** Answers that won't change by asking again soon: "no data" is cached instead of retried. */
function isDefinitive(e: unknown): boolean {
  return isServiceError(e) && (e.code === 'NOT_FOUND' || e.code === 'BAD_RESPONSE');
}

function expectedSession(ref: InstrumentRef, now: number): IsoDate {
  const market = ref.exchange
    ? EXCHANGE_META[ref.exchange].market
    : ref.key === 'INDEX:SP500' || ref.key === 'INDEX:VIX'
      ? 'US'
      : 'IN';
  return sessionDateFor(market, now);
}

/**
 * Appends the `recent` daily bars newer than the history's last date. Returns `null` when they
 * don't overlap (the app wasn't opened for a long time), so the history is refetched instead.
 */
function extendHistory(hist: CachedIndexHistory, recent: CachedBars | null): CachedIndexHistory | null {
  const last = hist.d.at(-1);
  if (!recent || last === undefined) return hist;
  const start = recent.d.findIndex((d) => d > last);
  if (start < 0) return hist;
  if (start === 0) return null;
  return { ...hist, d: [...hist.d, ...recent.d.slice(start)], a: [...hist.a, ...recent.a.slice(start)] };
}

/**
 * Applies a scraped close newer than the last bar: price, previous close (= last bar) and session
 * move on; bars, and so indicators, Health and rules, stay as they were (`indicatorsAsOf`).
 */
function withScrape(snap: PricedSnapshot, scraped: ScrapedClose | null, expected: IsoDate): PricedSnapshot {
  if (!scraped || scraped.sessionDate <= snap.sessionDate) return snap;
  return {
    ...snap,
    close: scraped.close,
    prevClose: snap.close,
    sessionDate: scraped.sessionDate,
    stale: scraped.sessionDate < expected,
    provider: 'quotepage',
    priceSource: 'SCRAPE',
  };
}

function toSnapshot(key: InstrumentKey, cached: CachedBars, expected: IsoDate): PricedSnapshot | null {
  const bars = fromCachedBars(cached);
  const last = bars.at(-1);
  if (!last) return null;
  return {
    key,
    sessionDate: last.date,
    close: last.close,
    prevClose: bars.at(-2)?.close ?? null,
    bars,
    stale: last.date < expected,
    provider: cached.provider,
    priceSource: 'BARS',
    indicatorsAsOf: last.date,
  };
}

/**
 * Creates the market-data service. Providers are tried in order (Yahoo, then Twelve Data for
 * bars and Finnhub for US fundamentals; the quote page for a stale latest close). A cached snapshot whose session is current is used without a network call, so
 * reopening the app the same evening costs nothing (LLD §3.8).
 */
export function createMarketDataService(deps: {
  readonly providers: readonly MarketDataProvider[];
  readonly kv: KeyValueCache;
  readonly clock: Clock;
}): MarketDataService {
  function readCache(key: InstrumentKey): CachedBars | null {
    return deps.kv.get(barsKey(key), CachedBarsSchema);
  }

  const readScrape = (key: InstrumentKey): ScrapedClose | null =>
    deps.kv.get(scrapeKey(key), ScrapedCloseSchema);

  /**
   * Last resort for a stale snapshot (HLD D33): only while its market is closed, so the page
   * shows that session's close, never an intraday price. At most one attempt per refresh.
   */
  async function scrapeIfStale(ref: InstrumentRef, snap: PricedSnapshot, expected: IsoDate, now: number) {
    if (!snap.stale || !ref.exchange) return snap;
    const cached = readScrape(snap.key);
    if (cached && cached.sessionDate >= expected) return withScrape(snap, cached, expected);
    if (!isMarketClosed(EXCHANGE_META[ref.exchange].market, now)) return withScrape(snap, cached, expected);
    for (const p of deps.providers) {
      if (!p.getLatestClose || !p.supports('LATEST_CLOSE', ref.exchange)) continue;
      try {
        const r = await p.getLatestClose(ref);
        const scraped = { sessionDate: r.sessionDate, close: r.close, fetchedAt: now };
        if (r.sessionDate > snap.sessionDate) deps.kv.set(scrapeKey(snap.key), scraped);
        return withScrape(snap, scraped, expected);
      } catch {
        // Fragile by nature: keep the stale snapshot.
      }
    }
    return withScrape(snap, cached, expected);
  }

  async function fetchBars(ref: InstrumentRef): Promise<CachedBars> {
    let lastError: unknown = null;
    for (const p of deps.providers) {
      if (!p.getDailyBars || !p.supports('BARS', ref.exchange)) continue;
      try {
        const result = await p.getDailyBars({ ref, range: { kind: '1y' } });
        const cached = toCachedBars(ref.key, result, deps.clock.now());
        if (cached) return cached;
      } catch (e) {
        lastError = e;
        // Wrong listing data is not fixed by another provider.
        if (isServiceError(e) && e.code === 'CURRENCY_MISMATCH') break;
      }
    }
    throw lastError ?? new Error('no provider');
  }

  async function fetchRange(ref: InstrumentRef, from: IsoDate): Promise<BarsResult> {
    let lastError: unknown = null;
    for (const p of deps.providers) {
      if (!p.getDailyBars || !p.supports('BARS', ref.exchange)) continue;
      try {
        return await p.getDailyBars({ ref, range: { kind: 'from', from } });
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error('no provider');
  }

  /** Tries each provider for one capability; `null` result = definitive "no data". */
  async function firstOf<T>(
    ref: InstrumentRef,
    cap: 'FUNDAMENTALS' | 'PROFILE',
    call: (p: MarketDataProvider) => Promise<T> | undefined,
  ): Promise<{ ok: true; value: T } | { ok: false; definitive: boolean }> {
    let error: unknown = null;
    for (const p of deps.providers) {
      if (!p.supports(cap, ref.exchange)) continue;
      const pending = call(p);
      if (!pending) continue;
      try {
        return { ok: true, value: await pending };
      } catch (e) {
        error = e;
      }
    }
    return { ok: false, definitive: isDefinitive(error) };
  }

  return {
    cachedSnapshots(refs) {
      const now = deps.clock.now();
      const out = new Map<InstrumentKey, PricedSnapshot>();
      for (const ref of refs) {
        const key = ref.key as InstrumentKey;
        const cached = readCache(key);
        const expected = expectedSession(ref, now);
        const snap = cached && toSnapshot(key, cached, expected);
        if (snap) out.set(key, withScrape(snap, readScrape(key), expected));
      }
      return out;
    },

    async getSnapshots(refs, opts) {
      const now = deps.clock.now();
      const snapshots = new Map<InstrumentKey, PricedSnapshot>();
      const failures: SnapshotFailure[] = [];
      let done = 0;
      let fetched = 0;
      await Promise.all(
        refs.map(async (ref) => {
          const key = ref.key as InstrumentKey;
          const expected = expectedSession(ref, now);
          const cached = readCache(key);
          const fresh =
            cached !== null && (cached.sessionDate >= expected || now - cached.fetchedAt < STALE_RETRY_MS);
          let use = cached;
          if (opts.force || !fresh) {
            try {
              use = await fetchBars(ref);
              deps.kv.set(barsKey(key), use);
              fetched += 1;
            } catch (e) {
              if (!cached) failures.push({ key, code: toMarketErrorCode(e) });
            }
          }
          const snap = use && toSnapshot(key, use, expected);
          if (snap) {
            // Bars caught up with the scraped session: the scrape is no longer needed.
            if (!snap.stale) deps.kv.delete(scrapeKey(key));
            snapshots.set(
              key,
              opts.force || !fresh
                ? await scrapeIfStale(ref, snap, expected, now)
                : withScrape(snap, readScrape(key), expected),
            );
          }
          done += 1;
          opts.onProgress?.(done, refs.length);
        }),
      );
      return { snapshots, failures, fetched };
    },

    cachedFundamentals(refs) {
      const out = new Map<InstrumentKey, Fundamentals | null>();
      for (const ref of refs) {
        if (ref.type !== 'EQUITY') continue;
        const c = deps.kv.get(fundamentalsKey(ref.key), CachedFundamentalsSchema);
        if (c) out.set(ref.key as InstrumentKey, c.data);
      }
      return out;
    },

    async getFundamentals(refs) {
      const now = deps.clock.now();
      const out = new Map<InstrumentKey, Fundamentals | null>();
      await Promise.all(
        refs.map(async (ref) => {
          const key = ref.key as InstrumentKey;
          // ETFs and indices have no company fundamentals: no network call.
          if (ref.type !== 'EQUITY') return;
          const cached = deps.kv.get(fundamentalsKey(key), CachedFundamentalsSchema);
          if (cached && now - cached.fetchedAt < FUNDAMENTALS_TTL_MS) {
            out.set(key, cached.data);
            return;
          }
          const r = await firstOf(ref, 'FUNDAMENTALS', (p) => p.getFundamentals?.(ref));
          if (r.ok || r.definitive) {
            const data = r.ok ? r.value : null;
            deps.kv.set(fundamentalsKey(key), { v: 1, key, fetchedAt: now, data });
            out.set(key, data);
          } else if (cached) {
            // Best effort: a transient failure keeps the old data and retries next refresh.
            out.set(key, cached.data);
          }
        }),
      );
      return out;
    },

    cachedProfiles(refs) {
      const out = new Map<InstrumentKey, InstrumentProfile>();
      for (const ref of refs) {
        if (ref.type === 'ETF') out.set(ref.key as InstrumentKey, { sector: 'ETF', industry: null });
        if (ref.type !== 'EQUITY') continue;
        const c = deps.kv.get(profileKey(ref.key), CachedProfileSchema);
        if (c) out.set(ref.key as InstrumentKey, c.profile);
      }
      return out;
    },

    async getProfiles(refs) {
      const now = deps.clock.now();
      const out = new Map<InstrumentKey, InstrumentProfile>();
      await Promise.all(
        refs.map(async (ref) => {
          const key = ref.key as InstrumentKey;
          if (ref.type === 'ETF') {
            out.set(key, { sector: 'ETF', industry: null });
            return;
          }
          if (ref.type !== 'EQUITY') return;
          const cached = deps.kv.get(profileKey(key), CachedProfileSchema);
          if (cached && now - cached.fetchedAt < PROFILE_TTL_MS) {
            out.set(key, cached.profile);
            return;
          }
          const r = await firstOf(ref, 'PROFILE', (p) => p.getProfile?.(ref));
          if (r.ok || r.definitive) {
            const profile = r.ok ? r.value : { sector: null, industry: null };
            deps.kv.set(profileKey(key), { v: 1, key, fetchedAt: now, profile });
            out.set(key, profile);
          } else if (cached) {
            out.set(key, cached.profile);
          }
        }),
      );
      return out;
    },

    cachedIndexHistory(index) {
      const hist = deps.kv.get(indexHistoryKey(index), CachedIndexHistorySchema);
      if (!hist) return null;
      return fromCachedIndexHistory(
        extendHistory(hist, readCache(BENCHMARK_KEY[index] as InstrumentKey)) ?? hist,
      );
    },

    async getIndexHistory(index, from) {
      const recent = readCache(BENCHMARK_KEY[index] as InstrumentKey);
      const hist = deps.kv.get(indexHistoryKey(index), CachedIndexHistorySchema);
      let next = hist && hist.from <= addDays(from, -7) ? extendHistory(hist, recent) : null;
      if (!next) {
        const start = addDays(hist && hist.from < from ? hist.from : from, -7);
        const result = await fetchRange(INDEX_REFS[BENCHMARK_KEY[index]], start);
        const fetched: CachedIndexHistory = {
          v: 1,
          index,
          from: start,
          fetchedAt: deps.clock.now(),
          d: result.bars.map((b) => b.date),
          a: result.bars.map((b) => b.adjClose),
        };
        next = extendHistory(fetched, recent) ?? fetched;
      }
      if (next !== hist) deps.kv.set(indexHistoryKey(index), next);
      return fromCachedIndexHistory(next);
    },
  };
}
