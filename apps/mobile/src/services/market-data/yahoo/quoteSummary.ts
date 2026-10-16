import type { Fundamentals, InstrumentProfile, IsoDate } from '@portfolio/core';
import { z } from 'zod';

import { ServiceError } from '../../http/errors';

/** Yahoo numeric field: `{ raw, fmt }`, or `{}` when Yahoo has no value. */
const YNum = z
  .object({ raw: z.number().nullable().optional() })
  .nullable()
  .optional()
  .transform((v) => (typeof v?.raw === 'number' && Number.isFinite(v.raw) ? v.raw : null));

const YStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

/** Yahoo `/v10/finance/quoteSummary` response for the four modules we request (LLD §3.3). */
export const YahooQuoteSummarySchema = z.object({
  quoteSummary: z.object({
    result: z
      .array(
        z.object({
          summaryDetail: z.object({ trailingPE: YNum, dividendYield: YNum }).optional(),
          defaultKeyStatistics: z.object({ priceToBook: YNum, pegRatio: YNum }).optional(),
          financialData: z
            .object({
              returnOnEquity: YNum,
              debtToEquity: YNum,
              currentRatio: YNum,
              revenueGrowth: YNum,
              earningsGrowth: YNum,
              profitMargins: YNum,
              freeCashflow: YNum,
            })
            .optional(),
          assetProfile: z.object({ sector: YStr, industry: YStr }).optional(),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string(), description: z.string().optional() }).nullable(),
  }),
});
/** Parsed quoteSummary response. */
export type YahooQuoteSummary = z.infer<typeof YahooQuoteSummarySchema>;

/** Modules requested in one call: fundamentals and profile together. */
export const QUOTE_SUMMARY_MODULES = 'financialData,defaultKeyStatistics,summaryDetail,assetProfile';

const pct = (v: number | null): number | null => (v === null ? null : v * 100);

function firstResult(qs: YahooQuoteSummary) {
  const err = qs.quoteSummary.error;
  if (err) throw new ServiceError(/not found/i.test(err.code) ? 'NOT_FOUND' : 'BAD_RESPONSE', 'yahoo');
  const r = qs.quoteSummary.result?.[0];
  if (!r) throw new ServiceError('NOT_FOUND', 'yahoo');
  return r;
}

/**
 * Maps quoteSummary to {@link Fundamentals} (LLD §3.3 table): ratios Yahoo gives as fractions
 * become percent; `debtToEquity` arrives in percent and becomes a ratio. Unavailable fields
 * (ROCE, interest cover, promoter holding, pledge) are `null`.
 */
export function parseFundamentals(qs: YahooQuoteSummary, asOf: IsoDate): Fundamentals {
  const r = firstResult(qs);
  const sd = r.summaryDetail;
  const ks = r.defaultKeyStatistics;
  const fd = r.financialData;
  const pe = sd?.trailingPE ?? null;
  const epsGrowthPct = pct(fd?.earningsGrowth ?? null);
  const peg =
    ks?.pegRatio ?? (pe !== null && epsGrowthPct !== null && epsGrowthPct > 0 ? pe / epsGrowthPct : null);
  const de = fd?.debtToEquity ?? null;
  const fcf = fd?.freeCashflow ?? null;
  const revenueGrowthPct = pct(fd?.revenueGrowth ?? null);
  return {
    pe,
    pb: ks?.priceToBook ?? null,
    peg,
    roePct: pct(fd?.returnOnEquity ?? null),
    roce: null,
    de: de === null ? null : de / 100,
    currentRatio: fd?.currentRatio ?? null,
    interestCoverage: null,
    revenueGrowthPct,
    epsGrowthPct,
    netMarginPct: pct(fd?.profitMargins ?? null),
    fcf: fcf === null ? null : { ttm: fcf, trend: null },
    dividendYieldPct: pct(sd?.dividendYield ?? null),
    promoterHoldingPct: null,
    pledgePct: null,
    growthBasis: revenueGrowthPct !== null || epsGrowthPct !== null ? 'YOY' : null,
    asOf,
    provider: 'yahoo',
  };
}

/** Sector/industry from the `assetProfile` module (both `null` when Yahoo has none, e.g. ETFs). */
export function parseProfile(qs: YahooQuoteSummary): InstrumentProfile {
  const r = firstResult(qs);
  return { sector: r.assetProfile?.sector ?? null, industry: r.assetProfile?.industry ?? null };
}
