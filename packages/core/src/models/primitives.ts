import { z } from 'zod';

/** Supported exchanges (HLD D24). An instrument is identified by `{ symbol, exchange }`, never by name. */
export const EXCHANGES = ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'NYSE_ARCA', 'NYSE_AMERICAN', 'CBOE'] as const;
export const ExchangeSchema = z.enum(EXCHANGES);
/** One of {@link EXCHANGES}. */
export type Exchange = z.infer<typeof ExchangeSchema>;

export const MARKETS = ['IN', 'US'] as const;
export const MarketSchema = z.enum(MARKETS);
/** Market an exchange belongs to. */
export type Market = z.infer<typeof MarketSchema>;

export const CURRENCIES = ['INR', 'USD'] as const;
export const CurrencySchema = z.enum(CURRENCIES);
/** Native currency of an instrument. */
export type Currency = z.infer<typeof CurrencySchema>;

/** Exchange → market/currency. Single source of truth; never inferred elsewhere. */
export const EXCHANGE_META: Readonly<Record<Exchange, { market: Market; currency: Currency }>> = {
  NSE: { market: 'IN', currency: 'INR' },
  BSE: { market: 'IN', currency: 'INR' },
  NASDAQ: { market: 'US', currency: 'USD' },
  NYSE: { market: 'US', currency: 'USD' },
  NYSE_ARCA: { market: 'US', currency: 'USD' },
  NYSE_AMERICAN: { market: 'US', currency: 'USD' },
  CBOE: { market: 'US', currency: 'USD' },
};

const SYMBOL_BODY = '[A-Z0-9][A-Z0-9.&_-]{0,19}';

/** Uppercase exchange ticker without provider suffix. BSE uses the scrip ID (e.g. RELIANCE), not the numeric code. */
export const SymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^${SYMBOL_BODY}$`), 'Invalid symbol');

/** True when `s` is `YYYY-MM-DD` and names a real calendar day (rejects 2024-02-30). */
export function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** ISO calendar date `YYYY-MM-DD` (exchange-local), used for trade and session dates. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isValidCalendarDate, 'Not a real calendar date');
/** ISO calendar date string `YYYY-MM-DD`. */
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Milliseconds since the Unix epoch (audit timestamps at the repository boundary). */
export type EpochMs = number;

const INSTRUMENT_KEY_RE = new RegExp(`^(${EXCHANGES.join('|')}):${SYMBOL_BODY}$`);

/** `"<EXCHANGE>:<SYMBOL>"`, e.g. `NSE:RELIANCE`. Used for maps, caches and local lookups. */
export type InstrumentKey = `${Exchange}:${string}`;

/** Validates an {@link InstrumentKey}. */
export const InstrumentKeySchema = z.custom<InstrumentKey>(
  (v) => typeof v === 'string' && INSTRUMENT_KEY_RE.test(v),
  'Invalid instrument key',
);

/** Builds the canonical key for an instrument. */
export function toInstrumentKey(exchange: Exchange, symbol: string): InstrumentKey {
  return `${exchange}:${symbol}`;
}

/** Splits a valid {@link InstrumentKey}; returns `null` for anything else. */
export function parseInstrumentKey(key: string): { exchange: Exchange; symbol: string } | null {
  if (!INSTRUMENT_KEY_RE.test(key)) return null;
  const i = key.indexOf(':');
  return { exchange: key.slice(0, i) as Exchange, symbol: key.slice(i + 1) };
}

/** Broker / app name as displayed. Matching is case-insensitive on the trimmed value. */
export const PlatformSchema = z.string().trim().min(1).max(40);

/** Case-insensitive comparison key for platform names. */
export function normalisePlatform(name: string): string {
  return name.trim().toLowerCase();
}

/** Current schema version written to every Firestore document. */
export const SCHEMA_VERSION = 1 as const;

/** Earliest accepted trade date. */
export const MIN_TRADE_DATE = '1990-01-01';
