import type { Label, MarketSnapshot } from '../market/types';
import type { Currency, Exchange, InstrumentKey, IsoDate, Market } from '../models/primitives';
import type { BuyTransaction } from '../models/transaction';

/** USD/INR rate with its ECB date plus history for trade-date conversion. */
export type FxContext = {
  /** INR per 1 USD. */
  readonly usdInr: number;
  readonly asOf: IsoDate;
  /** Ascending `{ date, rate }` rows (nearest-earlier lookup). */
  readonly history: readonly { readonly date: IsoDate; readonly rate: number }[];
};

/** Everything needed to price holdings (LLD §2.2). */
export type PricingContext = {
  /** Fallback valuation date when a holding has no snapshot (age calculations). */
  readonly valuationDate: IsoDate;
  readonly snapshots: ReadonlyMap<InstrumentKey, MarketSnapshot>;
  readonly fx: FxContext;
  /** override → provider profile → master industry → null. */
  readonly sectorOf: (key: InstrumentKey) => string | null;
  readonly labels: ReadonlyMap<InstrumentKey, { performance: Label | null; health: Label | null }>;
};

/** One broker's position in a stock (Edit sheet, S02c). */
export type BrokerPosition = {
  /** Display name (first-seen casing). */
  readonly platform: string;
  readonly quantity: number;
  readonly avgPrice: number;
  readonly invested: number;
  /** Ascending by trade date. */
  readonly buys: readonly BuyTransaction[];
};

/** One stock card, derived from its BUY transactions (LLD §2.3). Never stored. */
export type StockHolding = {
  readonly key: InstrumentKey;
  readonly symbol: string;
  readonly exchange: Exchange;
  readonly name: string;
  readonly market: Market;
  readonly currency: Currency;
  readonly sector: string | null;
  readonly quantity: number;
  readonly avgPrice: number;
  readonly invested: number;
  readonly close: number | null;
  readonly value: number | null;
  readonly pnl: number | null;
  readonly pnlPct: number | null;
  readonly dayChange: number | null;
  readonly dayChangePct: number | null;
  /** Annualised money-weighted return; `null` until the first buy is ≥ 365 days old. */
  readonly xirrPct: number | null;
  /** Quantity-weighted average age of the buys. */
  readonly holdingDays: number;
  readonly firstBuyDate: IsoDate;
  /** Session date of the price used (`null` without a snapshot). */
  readonly priceDate: IsoDate | null;
  /** Sorted by invested, descending. */
  readonly brokers: readonly BrokerPosition[];
  readonly performance: Label | null;
  readonly health: Label | null;
};

/** Label filter value: a label, or `NONE` for not rated / insufficient data. */
export type LabelFilter = Label | 'NONE';

/** Portfolio sort options (S02 / S02a). */
export type PortfolioSort = 'VALUE_DESC' | 'DAY_PNL_PCT_DESC' | 'PNL_PCT_DESC' | 'WEIGHT_DESC' | 'NAME_ASC';

/** Portfolio filters (S02a). Empty array = no filter. */
export type PortfolioFilters = {
  readonly platforms: readonly string[];
  readonly markets: readonly Market[];
  readonly exchanges: readonly Exchange[];
  readonly sectors: readonly string[];
  readonly performance: readonly LabelFilter[];
  readonly health: readonly LabelFilter[];
  readonly sort: PortfolioSort;
};

/** Filters that show everything, sorted by value. */
export const NO_FILTERS: PortfolioFilters = {
  platforms: [],
  markets: [],
  exchanges: [],
  sectors: [],
  performance: [],
  health: [],
  sort: 'VALUE_DESC',
};

/** Sector shown when a holding's sector is unknown. */
export const UNCLASSIFIED_SECTOR = 'Unclassified';

/** Sector header on S02. Amounts are in the summary currency (holdings themselves stay native). */
export type SectorGroup = {
  readonly sector: string;
  readonly holdings: readonly StockHolding[];
  readonly value: number;
  readonly invested: number;
  readonly pnl: number;
  readonly pnlPct: number | null;
  readonly weightPct: number | null;
};

/** Per-market block of the summary (US / India cards, allocation bar). */
export type MarketSummary = {
  readonly market: Market;
  /** Native currency of the market. */
  readonly value: number;
  readonly currency: Currency;
  readonly weightPct: number | null;
  readonly xirrPct: number | null;
};

/** S02 header, in the summary currency. Holdings without a price are excluded and counted. */
export type PortfolioSummary = {
  readonly currency: Currency;
  readonly totalValue: number;
  readonly invested: number;
  readonly unrealisedPnl: number;
  readonly unrealisedPnlPct: number | null;
  readonly dayChange: number;
  readonly dayChangePct: number | null;
  readonly xirrPct: number | null;
  readonly markets: readonly MarketSummary[];
  readonly unpricedCount: number;
  readonly fx: { readonly usdInr: number; readonly asOf: IsoDate };
};
