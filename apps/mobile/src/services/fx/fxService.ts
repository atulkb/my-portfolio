import {
  addDays,
  IsoDateSchema,
  sessionDateFor,
  type Clock,
  type FxContext,
  type IsoDate,
  type KeyValueCache,
} from '@portfolio/core';
import { z } from 'zod';

import type { HttpClient } from '../http/httpClient';
import { parseYahooChart, YahooChartSchema } from '../market-data/yahoo/chart';
import { YAHOO_HOST } from '../market-data/yahoo/yahooProvider';
import { YAHOO_USDINR } from '../market-data/symbols';

/** Frankfurter (ECB reference rates, no key), LLD §3.4. */
export const FRANKFURTER = 'https://api.frankfurter.dev/v1';
const FX_KEY = 'fx.usdInr';

const LatestSchema = z.object({ date: IsoDateSchema, rates: z.object({ INR: z.number().positive() }) });
const RangeSchema = z.object({ rates: z.record(z.string(), z.object({ INR: z.number().positive() })) });

const CachedFxSchema = z.object({
  v: z.literal(1),
  latest: z.object({ rate: z.number().positive(), asOf: IsoDateSchema, source: z.enum(['ECB', 'YAHOO']) }),
  /** IN session in which `latest` was fetched (refreshed once per IN session). */
  latestSession: IsoDateSchema,
  history: z
    .object({ from: IsoDateSchema, d: z.array(IsoDateSchema), r: z.array(z.number().positive()) })
    .nullable(),
  fetchedAt: z.number(),
});
type CachedFx = z.infer<typeof CachedFxSchema>;

/** FX snapshot for pricing plus where the latest rate came from. */
export type FxResult = {
  readonly context: FxContext;
  readonly source: 'ECB' | 'YAHOO';
  /** True when the network failed and a cached rate is shown. */
  readonly fromCache: boolean;
};

/** USD/INR service (LLD §3.4). */
export type FxService = {
  /** Cached rate only (no network), or null on first launch. */
  cached(): FxResult | null;
  /**
   * Latest rate (refetched once per IN session, or when forced) and history from `historyFrom`
   * (fetched once, then only extended). Never throws while a cached rate exists.
   */
  get(opts: { readonly historyFrom: IsoDate | null; readonly force: boolean }): Promise<FxResult | null>;
};

function toResult(c: CachedFx, fromCache: boolean): FxResult {
  const history = (c.history?.d ?? []).map((date, i) => ({ date, rate: c.history?.r[i] ?? c.latest.rate }));
  return {
    context: { usdInr: c.latest.rate, asOf: c.latest.asOf, history },
    source: c.latest.source,
    fromCache,
  };
}

function mergeHistory(
  prev: CachedFx['history'],
  from: IsoDate,
  rows: readonly [IsoDate, number][],
): NonNullable<CachedFx['history']> {
  const map = new Map<IsoDate, number>();
  prev?.d.forEach((d, i) => map.set(d, prev.r[i] ?? 0));
  for (const [d, r] of rows) map.set(d, r);
  const d = [...map.keys()].sort();
  return { from: prev && prev.from < from ? prev.from : from, d, r: d.map((x) => map.get(x) ?? 0) };
}

/** Creates the FX service: Frankfurter → Yahoo `USDINR=X` → cached rate. */
export function createFxService(deps: {
  readonly http: HttpClient;
  readonly kv: KeyValueCache;
  readonly clock: Clock;
}): FxService {
  const { http, kv } = deps;

  async function latestEcb(): Promise<CachedFx['latest']> {
    const j = await http.getJson(`${FRANKFURTER}/latest?base=USD&symbols=INR`, LatestSchema, {
      provider: 'frankfurter',
    });
    return { rate: j.rates.INR, asOf: j.date, source: 'ECB' };
  }

  async function latestYahoo(): Promise<CachedFx['latest']> {
    const chart = await http.getJson(
      `${YAHOO_HOST}/v8/finance/chart/${encodeURIComponent(YAHOO_USDINR)}?range=5d&interval=1d`,
      YahooChartSchema,
      { provider: 'yahoo' },
    );
    const { bars } = parseYahooChart(chart, { lastCompletedSession: '9999-12-31', expectedCurrency: 'INR' });
    const last = bars.at(-1);
    if (!last) throw new Error('no USDINR bars');
    return { rate: last.close, asOf: last.date, source: 'YAHOO' };
  }

  async function range(from: IsoDate, to: IsoDate): Promise<[IsoDate, number][]> {
    if (from > to) return [];
    const j = await http.getJson(`${FRANKFURTER}/${from}..${to}?base=USD&symbols=INR`, RangeSchema, {
      provider: 'frankfurter',
    });
    return Object.entries(j.rates)
      .filter(([d]) => IsoDateSchema.safeParse(d).success)
      .map(([d, v]) => [d, v.INR] as [IsoDate, number]);
  }

  return {
    cached() {
      const c = kv.get(FX_KEY, CachedFxSchema);
      return c ? toResult(c, true) : null;
    },

    async get({ historyFrom, force }) {
      const cached = kv.get(FX_KEY, CachedFxSchema);
      const session = sessionDateFor('IN', deps.clock.now());
      let next: CachedFx | null = cached;
      let networkFailed = false;

      if (force || !cached || cached.latestSession < session) {
        try {
          const latest = await latestEcb().catch(() => latestYahoo());
          next = {
            v: 1,
            latest,
            latestSession: session,
            history: cached?.history ?? null,
            fetchedAt: deps.clock.now(),
          };
        } catch {
          networkFailed = true;
        }
      }
      if (!next) return null;

      // History: once from the earliest buy (−7 days), then only extended (ECB rates never change).
      if (historyFrom) {
        const from = addDays(historyFrom, -7);
        const h = next.history;
        try {
          if (!h || from < h.from) {
            next = { ...next, history: mergeHistory(h, from, await range(from, next.latest.asOf)) };
          } else {
            const last = h.d.at(-1) ?? h.from;
            if (last < next.latest.asOf) {
              next = {
                ...next,
                history: mergeHistory(h, h.from, await range(addDays(last, 1), next.latest.asOf)),
              };
            }
          }
        } catch {
          networkFailed = true;
        }
      }
      kv.set(FX_KEY, next);
      return toResult(next, networkFailed);
    },
  };
}
