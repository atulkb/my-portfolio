import {
  EXCHANGE_META,
  sessionDateFor,
  type Capability,
  type Clock,
  type Exchange,
  type Fundamentals,
  type InstrumentProfile,
  type InstrumentRef,
  type IsoDate,
  type MarketDataProvider,
} from '@portfolio/core';
import { z } from 'zod';

import { ServiceError } from '../../http/errors';
import type { HttpClient } from '../../http/httpClient';

/** Finnhub API host. */
export const FINNHUB_HOST = 'https://finnhub.io/api/v1';

const n = z.number().finite().nullable().optional();
/** `GET /stock/metric?metric=all` (only the fields used; unknown symbols return `{}`). */
export const FinnhubMetricSchema = z.object({
  metric: z
    .object({
      peTTM: n,
      pb: n,
      roeTTM: n,
      'totalDebt/totalEquityQuarterly': n,
      currentRatioQuarterly: n,
      netInterestCoverageTTM: n,
      revenueGrowth3Y: n,
      epsGrowth3Y: n,
      revenueGrowthTTMYoy: n,
      epsGrowthTTMYoy: n,
      netProfitMarginTTM: n,
      dividendYieldIndicatedAnnual: n,
    })
    .passthrough()
    .optional(),
});
/** Parsed metric answer. */
export type FinnhubMetric = z.infer<typeof FinnhubMetricSchema>;

/** `GET /stock/profile2` (unknown symbols return `{}`). */
export const FinnhubProfileSchema = z.object({ finnhubIndustry: z.string().optional() }).passthrough();

const v = (x: number | null | undefined): number | null => (x === undefined || x === null ? null : x);

/**
 * Finnhub metrics → {@link Fundamentals} (LLD §3.3 mapping). Growth uses the 3-year CAGR when
 * both are present, else trailing YoY. Throws `NOT_FOUND` when Finnhub knows nothing.
 */
export function parseFinnhubMetric(res: FinnhubMetric, asOf: IsoDate): Fundamentals {
  const m = res.metric;
  if (!m || Object.keys(m).length === 0) throw new ServiceError('NOT_FOUND', 'finnhub');
  const cagr = v(m.revenueGrowth3Y) !== null || v(m.epsGrowth3Y) !== null;
  const revenueGrowthPct = cagr ? v(m.revenueGrowth3Y) : v(m.revenueGrowthTTMYoy);
  const epsGrowthPct = cagr ? v(m.epsGrowth3Y) : v(m.epsGrowthTTMYoy);
  const pe = v(m.peTTM);
  return {
    pe,
    pb: v(m.pb),
    peg: pe !== null && epsGrowthPct !== null && epsGrowthPct > 0 ? pe / epsGrowthPct : null,
    roePct: v(m.roeTTM),
    roce: null,
    de: v(m['totalDebt/totalEquityQuarterly']),
    currentRatio: v(m.currentRatioQuarterly),
    interestCoverage: v(m.netInterestCoverageTTM),
    revenueGrowthPct,
    epsGrowthPct,
    netMarginPct: v(m.netProfitMarginTTM),
    fcf: null,
    dividendYieldPct: v(m.dividendYieldIndicatedAnnual),
    promoterHoldingPct: null,
    pledgePct: null,
    growthBasis: revenueGrowthPct !== null || epsGrowthPct !== null ? (cagr ? 'CAGR3Y' : 'YOY') : null,
    asOf,
    provider: 'finnhub',
  };
}

/**
 * US fundamentals and sector fallback (LLD §3.3); never used for bars (candles are not on the
 * free plan). Without an API key the provider reports no support.
 */
export function createFinnhubProvider(http: HttpClient, clock: Clock, apiKey: string): MarketDataProvider {
  const usEquity = (exchange: Exchange | null): boolean =>
    exchange !== null && EXCHANGE_META[exchange].market === 'US';
  const url = (path: string, ref: InstrumentRef): string =>
    `${FINNHUB_HOST}${path}symbol=${encodeURIComponent(ref.symbol)}&token=${encodeURIComponent(apiKey)}`;

  return {
    id: 'finnhub',
    supports: (cap: Capability, exchange: Exchange | null) =>
      !!apiKey && (cap === 'FUNDAMENTALS' || cap === 'PROFILE') && usEquity(exchange),
    async getFundamentals(ref) {
      const res = await http.getJson(url('/stock/metric?metric=all&', ref), FinnhubMetricSchema, {
        provider: 'finnhub',
        retries: 0,
      });
      return parseFinnhubMetric(res, sessionDateFor('US', clock.now()));
    },
    async getProfile(ref): Promise<InstrumentProfile> {
      const res = await http.getJson(url('/stock/profile2?', ref), FinnhubProfileSchema, {
        provider: 'finnhub',
        retries: 0,
      });
      if (!res.finnhubIndustry) throw new ServiceError('NOT_FOUND', 'finnhub');
      return { sector: res.finnhubIndustry, industry: null };
    },
  };
}
