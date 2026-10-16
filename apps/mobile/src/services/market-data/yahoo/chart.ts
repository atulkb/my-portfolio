import type { BarsResult, Currency, DailyBar, IsoDate } from '@portfolio/core';
import { z } from 'zod';

import { ServiceError } from '../../http/errors';

const num = z.number().nullable().optional();
const series = z.array(num);

/** Yahoo `/v8/finance/chart` response (fields we use; everything else ignored). */
export const YahooChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            currency: z.string().nullable().optional(),
            exchangeTimezoneName: z.string(),
            instrumentType: z.string().optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(
              z.object({ open: series, high: series, low: series, close: series, volume: series }),
            ),
            adjclose: z.array(z.object({ adjclose: series })).optional(),
          }),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string(), description: z.string().optional() }).nullable(),
  }),
});
/** Parsed Yahoo chart response. */
export type YahooChart = z.infer<typeof YahooChartSchema>;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Exchange-local calendar date of a Unix timestamp (seconds). */
export function localDate(epochSec: number, timeZone: string): IsoDate {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, f);
  }
  return f.format(new Date(epochSec * 1000));
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Converts a Yahoo chart into completed daily bars (LLD §3.3): dates in the exchange time zone,
 * rows with any missing price dropped, duplicate dates keep the last row, and bars after
 * `lastCompletedSession` (today's session still trading) removed. When `expectedCurrency` is
 * given, `meta.currency` must match it (guards against wrong listings such as GBp quotes).
 *
 * @throws ServiceError NOT_FOUND for unknown symbols, CURRENCY_MISMATCH, BAD_RESPONSE.
 */
export function parseYahooChart(
  chart: YahooChart,
  opts: { readonly lastCompletedSession: IsoDate; readonly expectedCurrency: Currency | null },
): BarsResult {
  const err = chart.chart.error;
  if (err)
    throw new ServiceError(err.code === 'Not Found' ? 'NOT_FOUND' : 'BAD_RESPONSE', 'yahoo', {
      message: err.description,
    });
  const r = chart.chart.result?.[0];
  if (!r) throw new ServiceError('NOT_FOUND', 'yahoo');
  const currency = r.meta.currency ?? null;
  if (opts.expectedCurrency && currency !== opts.expectedCurrency) {
    throw new ServiceError('CURRENCY_MISMATCH', 'yahoo', {
      message: `currency ${currency ?? 'none'}`,
      retryable: false,
    });
  }
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const ts = r.timestamp ?? [];
  const byDate = new Map<IsoDate, DailyBar>();
  ts.forEach((t, i) => {
    const open = q?.open[i];
    const high = q?.high[i];
    const low = q?.low[i];
    const close = q?.close[i];
    if (!isNum(open) || !isNum(high) || !isNum(low) || !isNum(close) || close <= 0) return;
    const date = localDate(t, r.meta.exchangeTimezoneName);
    if (date > opts.lastCompletedSession) return;
    const adjClose = adj?.[i];
    byDate.set(date, {
      date,
      open,
      high,
      low,
      close,
      adjClose: isNum(adjClose) ? adjClose : close,
      volume: isNum(q?.volume[i]) ? (q?.volume[i] as number) : 0,
    });
  });
  const bars = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const parsedCurrency = currency === 'INR' || currency === 'USD' ? currency : null;
  return { bars, currency: parsedCurrency, adjusted: adj !== undefined, provider: 'yahoo' };
}
