import {
  EXCHANGE_META,
  sessionDateFor,
  type AppErrorCode,
  type Clock,
  type InstrumentKey,
  type InstrumentRef,
  type IsoDate,
  type KeyValueCache,
  type MarketDataProvider,
  type MarketSnapshot,
} from '@portfolio/core';

import { isServiceError, toMarketErrorCode } from '../http/errors';
import { barsKey, CachedBarsSchema, fromCachedBars, toCachedBars, type CachedBars } from './cache';

/** A snapshot plus where it came from (LLD §3.3). */
export type PricedSnapshot = MarketSnapshot & {
  /** Older than the expected session for its market (provider down or exchange holiday). */
  readonly stale: boolean;
  readonly provider: string;
  /** 'SCRAPE' arrives with the M9 quote-page fallback. */
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
};

/** Don't re-ask a provider for a session it didn't have (e.g. exchange holiday) more often than this. */
export const STALE_RETRY_MS = 30 * 60 * 1000;

function expectedSession(ref: InstrumentRef, now: number): IsoDate {
  const market = ref.exchange ? EXCHANGE_META[ref.exchange].market : 'IN';
  return sessionDateFor(market, now);
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
 * Creates the market-data service. Providers are tried in order (M5: Yahoo only; Twelve Data
 * joins in M9). A cached snapshot whose session is current is used without a network call, so
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

  return {
    cachedSnapshots(refs) {
      const now = deps.clock.now();
      const out = new Map<InstrumentKey, PricedSnapshot>();
      for (const ref of refs) {
        const key = ref.key as InstrumentKey;
        const cached = readCache(key);
        const snap = cached && toSnapshot(key, cached, expectedSession(ref, now));
        if (snap) out.set(key, snap);
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
          if (snap) snapshots.set(key, snap);
          done += 1;
          opts.onProgress?.(done, refs.length);
        }),
      );
      return { snapshots, failures, fetched };
    },
  };
}
