import {
  EXCHANGE_META,
  sessionDateFor,
  type BarsRequest,
  type BarsResult,
  type Capability,
  type Clock,
  type DailyBar,
  type Exchange,
  type IsoDate,
  type MarketDataProvider,
} from '@portfolio/core';
import { z } from 'zod';

import { ServiceError } from '../../http/errors';
import type { HttpClient } from '../../http/httpClient';
import { twelveDataSymbol } from '../symbols';

/** Twelve Data API host. */
export const TWELVE_DATA_HOST = 'https://api.twelvedata.com';

/** Free plan: 8 requests per minute (LLD §3.3); beyond that the fallback yields to the cache. */
export const TWELVE_DATA_PER_MINUTE = 8;
const SESSIONS = 260;

const num = z.coerce.number();
/** `GET /time_series` (numbers arrive as strings; newest bar first). */
export const TwelveDataSeriesSchema = z.union([
  z.object({
    status: z.literal('ok'),
    meta: z.object({ currency: z.string().optional() }).passthrough(),
    values: z.array(
      z.object({
        datetime: z.string(),
        open: num,
        high: num,
        low: num,
        close: num,
        volume: num.optional(),
      }),
    ),
  }),
  z.object({ status: z.literal('error'), code: z.number(), message: z.string().optional() }),
]);
/** Parsed `time_series` answer. */
export type TwelveDataSeries = z.infer<typeof TwelveDataSeriesSchema>;

/** Converts a series into bars (oldest first). No adjusted close: `adjClose = close`, `adjusted: false`. */
export function parseTwelveDataSeries(
  res: TwelveDataSeries,
  opts: { readonly lastCompletedSession: IsoDate; readonly expectedCurrency: string },
): BarsResult {
  if (res.status === 'error') {
    const code =
      res.code === 401 || res.code === 403
        ? 'AUTH'
        : res.code === 400 || res.code === 404
          ? 'NOT_FOUND'
          : res.code === 429
            ? 'RATE_LIMITED'
            : 'PROVIDER_DOWN';
    throw new ServiceError(code, 'twelvedata', { message: res.message, retryable: false });
  }
  const currency = res.meta.currency ?? null;
  if (currency !== null && currency !== opts.expectedCurrency)
    throw new ServiceError('CURRENCY_MISMATCH', 'twelvedata', { retryable: false });
  const byDate = new Map<IsoDate, DailyBar>();
  for (const v of res.values) {
    const date = v.datetime.slice(0, 10);
    if (date > opts.lastCompletedSession || !(v.close > 0)) continue;
    byDate.set(date, {
      date,
      open: v.open,
      high: v.high,
      low: v.low,
      close: v.close,
      adjClose: v.close,
      volume: v.volume ?? 0,
    });
  }
  const bars = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (bars.length === 0) throw new ServiceError('NOT_FOUND', 'twelvedata');
  return {
    bars,
    currency: opts.expectedCurrency as BarsResult['currency'],
    adjusted: false,
    provider: 'twelvedata',
  };
}

/**
 * Fallback daily bars (LLD §3.3), used only when Yahoo fails. Without an API key the provider
 * reports no support. Indian coverage on the free plan is unverified (spike S3), so NSE/BSE can
 * be switched off with `india: false`.
 */
export function createTwelveDataProvider(
  http: HttpClient,
  clock: Clock,
  opts: { readonly apiKey: string; readonly india: boolean },
): MarketDataProvider {
  const recent: number[] = [];

  function takeSlot(): void {
    const now = clock.now();
    while (recent.length > 0 && now - (recent[0] ?? 0) >= 60_000) recent.shift();
    if (recent.length >= TWELVE_DATA_PER_MINUTE)
      throw new ServiceError('RATE_LIMITED', 'twelvedata', { retryable: false });
    recent.push(now);
  }

  return {
    id: 'twelvedata',
    supports: (cap: Capability, exchange: Exchange | null) => {
      if (cap !== 'BARS' || !opts.apiKey || exchange === null) return false;
      return opts.india || EXCHANGE_META[exchange].market === 'US';
    },
    async getDailyBars(req: BarsRequest): Promise<BarsResult> {
      const s = twelveDataSymbol(req.ref);
      if (!s || !req.ref.exchange) throw new ServiceError('UNSUPPORTED', 'twelvedata');
      takeSlot();
      const meta = EXCHANGE_META[req.ref.exchange];
      const range =
        req.range.kind === '1y' ? `outputsize=${SESSIONS}` : `start_date=${req.range.from}&outputsize=5000`;
      const url =
        `${TWELVE_DATA_HOST}/time_series?symbol=${encodeURIComponent(s.symbol)}` +
        `&exchange=${encodeURIComponent(s.exchange)}&interval=1day&${range}&apikey=${encodeURIComponent(opts.apiKey)}`;
      const res = await http.getJson(url, TwelveDataSeriesSchema, { provider: 'twelvedata', retries: 0 });
      return parseTwelveDataSeries(res, {
        lastCompletedSession: sessionDateFor(meta.market, clock.now()),
        expectedCurrency: meta.currency,
      });
    },
  };
}
