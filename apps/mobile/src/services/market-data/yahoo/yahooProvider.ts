import {
  EXCHANGE_META,
  type BarsRequest,
  type BarsResult,
  type Capability,
  type Clock,
  type IsoDate,
  type MarketDataProvider,
  type Market,
  type InstrumentRef,
  sessionDateFor,
} from '@portfolio/core';

import { isServiceError } from '../../http/errors';
import type { HttpClient } from '../../http/httpClient';
import { yahooSymbol } from '../symbols';
import { parseYahooChart, YahooChartSchema } from './chart';
import {
  parseFundamentals,
  parseProfile,
  QUOTE_SUMMARY_MODULES,
  YahooQuoteSummarySchema,
  type YahooQuoteSummary,
} from './quoteSummary';
import { createYahooSession, YAHOO_DESKTOP_HEADERS } from './session';

/** Yahoo hosts (two mirrors; the client limits each). */
export const YAHOO_HOST = 'https://query1.finance.yahoo.com';

/** Calendar days requested for the "1 year" bars (enough for 252 sessions plus holidays). */
const YEAR_PLUS_DAYS = 380;

/** One quoteSummary answer serves both fundamentals and profile when they expire together. */
const QS_MEMO_MS = 10 * 60 * 1000;

function toEpochSec(d: IsoDate): number {
  return Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
}

/**
 * Yahoo adapter (LLD §3.3): daily bars from the chart endpoint (no cookie needed), and
 * fundamentals + profile from quoteSummary (cookie + crumb, best effort). One quoteSummary call
 * returns both and is reused for {@link QS_MEMO_MS}.
 */
export function createYahooProvider(http: HttpClient, clock: Clock): MarketDataProvider {
  const session = createYahooSession(http, YAHOO_HOST, clock.now);
  const memo = new Map<string, { at: number; value: Promise<YahooQuoteSummary> }>();

  async function fetchSummary(sym: string, retryAuth = true): Promise<YahooQuoteSummary> {
    const crumb = await session.crumb();
    const url = `${YAHOO_HOST}/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${QUOTE_SUMMARY_MODULES}&crumb=${encodeURIComponent(crumb)}`;
    try {
      return await http.getJson(url, YahooQuoteSummarySchema, {
        provider: 'yahoo',
        headers: YAHOO_DESKTOP_HEADERS,
      });
    } catch (e) {
      if (retryAuth && isServiceError(e) && e.code === 'AUTH') {
        session.invalidate();
        return fetchSummary(sym, false);
      }
      throw e;
    }
  }

  function summary(ref: InstrumentRef): Promise<YahooQuoteSummary> {
    const sym = yahooSymbol(ref);
    const hit = memo.get(sym);
    if (hit && clock.now() - hit.at < QS_MEMO_MS) return hit.value;
    const value = fetchSummary(sym);
    memo.set(sym, { at: clock.now(), value });
    value.catch(() => memo.delete(sym));
    return value;
  }

  const today = (ref: InstrumentRef): IsoDate =>
    sessionDateFor(ref.exchange ? EXCHANGE_META[ref.exchange].market : 'IN', clock.now());

  return {
    id: 'yahoo',
    supports: (cap: Capability) => cap === 'BARS' || cap === 'FUNDAMENTALS' || cap === 'PROFILE',
    async getFundamentals(ref) {
      return parseFundamentals(await summary(ref), today(ref));
    },
    async getProfile(ref) {
      return parseProfile(await summary(ref));
    },
    async getDailyBars(req: BarsRequest): Promise<BarsResult> {
      const sym = encodeURIComponent(yahooSymbol(req.ref));
      // `range=1y` returns ~251 sessions, one short of a full 52-week window (252): ask for
      // 380 calendar days (~262 sessions) instead (LLD §2.6).
      const nowSec = Math.floor(clock.now() / 1000);
      const period1 = req.range.kind === '1y' ? nowSec - YEAR_PLUS_DAYS * 86_400 : toEpochSec(req.range.from);
      const range = `period1=${period1}&period2=${nowSec}`;
      const url = `${YAHOO_HOST}/v8/finance/chart/${sym}?${range}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
      const chart = await http.getJson(url, YahooChartSchema, {
        provider: 'yahoo',
        headers: YAHOO_DESKTOP_HEADERS,
      });
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
