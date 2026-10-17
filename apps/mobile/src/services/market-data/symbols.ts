import type { IndexKey, InstrumentRef } from '@portfolio/core';

/** Yahoo symbols of the index pseudo-keys (LLD §3.1). */
export const YAHOO_INDEX_SYMBOLS: Readonly<Record<IndexKey, string>> = {
  'INDEX:NIFTY50': '^NSEI',
  'INDEX:SP500': '^GSPC',
  'INDEX:INDIAVIX': '^INDIAVIX',
  'INDEX:VIX': '^VIX',
};

/** Yahoo symbol of the USD/INR rate (FX fallback, LLD §3.4). */
export const YAHOO_USDINR = 'USDINR=X';

/**
 * Yahoo chart symbol (LLD §3.3, the only place provider symbols are produced):
 * NSE `RELIANCE.NS`; BSE `RELIANCE.BO` (the ticker, verified 2026-10-16: numeric scrip codes such
 * as `500325.BO` return 404); US class shares use `-` (`BRK.B` → `BRK-B`); indices `^NSEI` etc.
 */
export function yahooSymbol(ref: InstrumentRef): string {
  if (ref.type === 'INDEX') return YAHOO_INDEX_SYMBOLS[ref.key as IndexKey] ?? ref.symbol;
  switch (ref.exchange) {
    case 'NSE':
      return `${ref.symbol}.NS`;
    case 'BSE':
      return `${ref.symbol}.BO`;
    default:
      return ref.symbol.replace(/\./g, '-');
  }
}

/** Google Finance exchange codes for US listings (LLD §3.3). */
const QUOTE_PAGE_US: Readonly<Record<string, string>> = {
  NASDAQ: 'NASDAQ',
  NYSE: 'NYSE',
  NYSE_ARCA: 'NYSEARCA',
  NYSE_AMERICAN: 'NYSEAMERICAN',
  CBOE: 'BATS',
};

/**
 * Quote-page symbol: `RELIANCE:NSE`; BSE needs the numeric scrip code (`500325:BOM`, verified
 * 2026-10-17: the ticker form returns no price) → `null` without one; US `BRK.B:NYSE`.
 */
export function quotePageSymbol(ref: InstrumentRef): string | null {
  if (ref.type === 'INDEX' || !ref.exchange) return null;
  if (ref.exchange === 'NSE') return `${ref.symbol}:NSE`;
  if (ref.exchange === 'BSE') return ref.bseCode ? `${ref.bseCode}:BOM` : null;
  const ex = QUOTE_PAGE_US[ref.exchange];
  return ex ? `${ref.symbol}:${ex}` : null;
}

/** Twelve Data symbol + exchange (US class shares keep the dot). */
export function twelveDataSymbol(ref: InstrumentRef): { symbol: string; exchange: string } | null {
  if (ref.type === 'INDEX' || !ref.exchange) return null;
  if (ref.exchange === 'NSE' || ref.exchange === 'BSE') return { symbol: ref.symbol, exchange: ref.exchange };
  return {
    symbol: ref.symbol,
    exchange: ref.exchange === 'NYSE_ARCA' ? 'NYSE' : ref.exchange.replace('_', ' '),
  };
}
