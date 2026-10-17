import type { EpochMs, IsoDate, Market } from '../models/primitives';
import { addDays, weekday } from '../util/dates';

/** Exchange time zone and regular session hours (minutes after local midnight). */
export const MARKET_HOURS: Readonly<Record<Market, { timeZone: string; openMin: number; closeMin: number }>> =
  {
    IN: { timeZone: 'Asia/Kolkata', openMin: 9 * 60 + 15, closeMin: 15 * 60 + 30 },
    US: { timeZone: 'America/New_York', openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Calendar date at `now` in any IANA time zone (e.g. Gemini quota days run on Pacific time). */
export function dateInTimeZone(timeZone: string, now: EpochMs): IsoDate {
  const parts = formatterFor(timeZone).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Local calendar date and minutes after midnight at `now` in the market's time zone. */
export function marketLocalTime(market: Market, now: EpochMs): { date: IsoDate; minutes: number } {
  const parts = formatterFor(MARKET_HOURS[market].timeZone).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const isWeekend = (d: IsoDate): boolean => {
  const w = weekday(d);
  return w === 0 || w === 6;
};

function previousWeekday(d: IsoDate): IsoDate {
  let x = addDays(d, -1);
  while (isWeekend(x)) x = addDays(x, -1);
  return x;
}

/**
 * Last completed session date for a market (LLD §2.2): today if it is a weekday and the close
 * has passed, otherwise the previous weekday. Exchange holidays are not modelled — when a
 * fetched snapshot is older than this, the snapshot's own date wins.
 */
export function sessionDateFor(market: Market, now: EpochMs): IsoDate {
  const { date, minutes } = marketLocalTime(market, now);
  if (!isWeekend(date) && minutes >= MARKET_HOURS[market].closeMin) return date;
  return previousWeekday(date);
}

/**
 * True outside regular trading hours (before the open, after the close, or at weekends). Used
 * to allow the last-resort scraped close only when it cannot be an intraday price (HLD D33).
 */
export function isMarketClosed(market: Market, now: EpochMs): boolean {
  const { date, minutes } = marketLocalTime(market, now);
  const { openMin, closeMin } = MARKET_HOURS[market];
  return isWeekend(date) || minutes < openMin || minutes >= closeMin;
}
