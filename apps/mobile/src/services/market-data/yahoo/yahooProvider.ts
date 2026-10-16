import {
  EXCHANGE_META,
  type BarsRequest,
  type BarsResult,
  type Capability,
  type Clock,
  type IsoDate,
  type MarketDataProvider,
  type Market,
  sessionDateFor,
} from '@portfolio/core';

import type { HttpClient } from '../../http/httpClient';
import { yahooSymbol } from '../symbols';
import { parseYahooChart, YahooChartSchema } from './chart';

/** Yahoo hosts (two mirrors; the client limits each). */
export const YAHOO_HOST = 'https://query1.finance.yahoo.com';

/** Mobile browser UA: Yahoo rejects some default client agents. */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  Accept: 'application/json',
};

function toEpochSec(d: IsoDate): number {
  return Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
}

/**
 * Yahoo chart adapter (LLD §3.3): daily bars only in M5. Fundamentals and profile
 * (quoteSummary with cookie + crumb) are added with M6.
 */
export function createYahooProvider(http: HttpClient, clock: Clock): MarketDataProvider {
  return {
    id: 'yahoo',
    supports: (cap: Capability) => cap === 'BARS',
    async getDailyBars(req: BarsRequest): Promise<BarsResult> {
      const sym = encodeURIComponent(yahooSymbol(req.ref));
      const range =
        req.range.kind === '1y'
          ? 'range=1y'
          : `period1=${toEpochSec(req.range.from)}&period2=${Math.floor(clock.now() / 1000)}`;
      const url = `${YAHOO_HOST}/v8/finance/chart/${sym}?${range}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
      const chart = await http.getJson(url, YahooChartSchema, { provider: 'yahoo', headers: HEADERS });
      const market: Market = req.ref.exchange
        ? EXCHANGE_META[req.ref.exchange].market
        : req.ref.key === 'INDEX:SP500' || req.ref.key === 'INDEX:VIX'
          ? 'US'
          : 'IN';
      return parseYahooChart(chart, {
        lastCompletedSession: sessionDateFor(market, clock.now()),
        expectedCurrency: req.ref.exchange ? EXCHANGE_META[req.ref.exchange].currency : null,
      });
    },
  };
}
