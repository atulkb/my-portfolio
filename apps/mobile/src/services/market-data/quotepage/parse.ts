import type { Currency, IsoDate, LatestCloseResult } from '@portfolio/core';

import { ServiceError } from '../../http/errors';

const PROVIDER = 'quotepage';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The one place the page layout is encoded (LLD §3.3). Google Finance renders the headline price
 * as `<div class="N6SYTe"><span jsname="Pdsbrc" …><span>₹1,211.20</span>` followed by a status
 * line such as `Closed: Oct 16, 4:00:01 PM GMT-4 · USD` or `Oct 16, 3:30:00 PM GMT+5:30 · INR`.
 * The time uses a narrow no-break space before AM/PM (hence `\s`). Recorded fixtures
 * (2026-10-17) fail the tests loudly when this changes.
 */
const PRICE_BLOCK = 'class="N6SYTe"';
const PRICE_RE = /<span>([^<]+)<\/span>/;
const STATUS_RE =
  /([A-Z][a-z]{2})\s(\d{1,2}),\s\d{1,2}:\d{2}(?::\d{2})?\s[AP]M\sGMT[+-]\d{1,2}(?::\d{2})?(?:&nbsp;|\s|&middot;|·)+([A-Z]{3})/;
/** How far after the price block the status line may appear. */
const WINDOW = 3000;

function bad(message: string): ServiceError {
  return new ServiceError('BAD_RESPONSE', PROVIDER, { message });
}

/** "₹1,211.20" / "$343.46" → number (positive), else `null`. */
function parsePrice(text: string): number | null {
  const cleaned = text.replace(/&nbsp;/g, '').replace(/[₹$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

/** "Oct 16" with no year → the most recent such date on or before `today`. */
function toIsoDate(month: string, day: number, today: IsoDate): IsoDate | null {
  const m = MONTHS.indexOf(month);
  if (m < 0 || day < 1 || day > 31) return null;
  let year = Number(today.slice(0, 4));
  const iso = (y: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (iso(year) > today) year -= 1;
  return iso(year);
}

/**
 * Reads the latest close from a quote page. Throws `BAD_RESPONSE` when the layout is not
 * recognised, the price isn't a positive number or the currency differs from `expected`.
 */
export function parseQuotePage(html: string, expected: Currency, today: IsoDate): LatestCloseResult {
  const at = html.indexOf(PRICE_BLOCK);
  if (at < 0) throw bad('price block not found');
  const block = html.slice(at, at + WINDOW);
  const priceText = PRICE_RE.exec(block)?.[1];
  const close = priceText ? parsePrice(priceText) : null;
  if (close === null) throw bad('price not a positive number');
  const status = STATUS_RE.exec(block);
  if (!status) throw bad('status line not found');
  const [, month = '', day = '', currency = ''] = status;
  if (currency !== expected) throw new ServiceError('CURRENCY_MISMATCH', PROVIDER);
  const sessionDate = toIsoDate(month, Number(day), today);
  if (!sessionDate) throw bad('date not recognised');
  return { close, sessionDate, currency: expected };
}
