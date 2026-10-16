import { z } from 'zod';
import type { Currency, Exchange, InstrumentKey, IsoDate } from '../models/primitives';

/** Qualitative label used by both badges (Performance, Health). */
export const LABELS = ['GOOD', 'AVERAGE', 'BAD'] as const;
export const LabelSchema = z.enum(LABELS);
/** GOOD | AVERAGE | BAD; `null` where used means not rated / insufficient data. */
export type Label = z.infer<typeof LabelSchema>;

/** One completed daily session (LLD §2.2). */
export type DailyBar = {
  /** Exchange-local session date. */
  readonly date: IsoDate;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  /** As traded: used for prices, P/L and value. */
  readonly close: number;
  /** Split/dividend adjusted: used for indicators and return series. */
  readonly adjClose: number;
  readonly volume: number;
};

/** Latest completed session plus ~1 year of bars for one instrument. */
export type MarketSnapshot = {
  readonly key: InstrumentKey;
  /** Last completed session. */
  readonly sessionDate: IsoDate;
  readonly close: number;
  readonly prevClose: number | null;
  /** Ascending, ~260 sessions. */
  readonly bars: readonly DailyBar[];
};

const nullableNumber = z.number().finite().nullable();

/**
 * Fundamental ratios (LLD §3.3). All values may be `null` (unavailable); percentages are
 * expressed as percent (15 = 15 %).
 */
export const FundamentalsSchema = z.object({
  pe: nullableNumber,
  pb: nullableNumber,
  peg: nullableNumber,
  roePct: nullableNumber,
  roce: nullableNumber,
  de: nullableNumber,
  currentRatio: nullableNumber,
  interestCoverage: nullableNumber,
  revenueGrowthPct: nullableNumber,
  epsGrowthPct: nullableNumber,
  netMarginPct: nullableNumber,
  fcf: z
    .object({ ttm: z.number().finite(), trend: z.enum(['GROWING', 'FLAT', 'DECLINING']).nullable() })
    .nullable(),
  dividendYieldPct: nullableNumber,
  promoterHoldingPct: nullableNumber,
  pledgePct: nullableNumber,
  growthBasis: z.enum(['CAGR3Y', 'YOY']).nullable(),
  asOf: z.string(),
  provider: z.string(),
});
/** Fundamental ratios for one instrument. */
export type Fundamentals = z.infer<typeof FundamentalsSchema>;

/** Sector/industry from a market-data provider. */
export const InstrumentProfileSchema = z.object({
  sector: z.string().nullable(),
  industry: z.string().nullable(),
});
/** Sector/industry from a market-data provider. */
export type InstrumentProfile = z.infer<typeof InstrumentProfileSchema>;

/** Market-data capabilities a provider may support. */
export type Capability = 'BARS' | 'LATEST_CLOSE' | 'FUNDAMENTALS' | 'PROFILE';

/** Pseudo-keys for indices used only inside services, never persisted in Firestore. */
export type IndexKey = 'INDEX:NIFTY50' | 'INDEX:SP500' | 'INDEX:INDIAVIX' | 'INDEX:VIX';

/** Everything a provider needs to fetch one instrument (built from the master list). */
export type InstrumentRef = {
  readonly key: InstrumentKey | IndexKey;
  readonly symbol: string;
  /** `null` for indices. */
  readonly exchange: Exchange | null;
  /** BSE numeric scrip code from the master list. */
  readonly bseCode: string | null;
  readonly type: 'EQUITY' | 'ETF' | 'INDEX';
};

/** Range of daily bars requested from a provider. */
export type BarsRequest = {
  readonly ref: InstrumentRef;
  readonly range: { readonly kind: '1y' } | { readonly kind: 'from'; readonly from: IsoDate };
};

/** Daily bars returned by a provider. */
export type BarsResult = {
  readonly bars: DailyBar[];
  readonly currency: Currency | null;
  /** False when the provider has no adjusted close (adjClose = close). */
  readonly adjusted: boolean;
  readonly provider: string;
};

/** Latest close from the last-resort quote-page provider (HLD D33). */
export type LatestCloseResult = {
  readonly close: number;
  readonly sessionDate: IsoDate;
  readonly currency: Currency;
};
