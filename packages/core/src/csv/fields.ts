import { isValidCalendarDate, MIN_TRADE_DATE, type Exchange, type IsoDate } from '../models/primitives';
import { editDistance } from '../util/text';
import { CSV_COLUMNS, type CsvColumn } from './types';

const norm = (h: string): string => h.toLowerCase().replace(/[\s_-]+/g, '');

/** Accepted header aliases per canonical column (LLD §2.9). */
export const HEADER_ALIASES: Readonly<Record<CsvColumn, readonly string[]>> = {
  symbol: ['ticker', 'scrip', 'tradingsymbol', 'instrument'],
  name: ['company', 'company_name', 'stock_name', 'security'],
  exchange: ['exch', 'market_exchange'],
  quantity: ['qty', 'shares', 'units'],
  buy_price: ['price', 'avg_price', 'average_price', 'cost', 'buy_avg'],
  buy_date: ['date', 'trade_date', 'purchase_date'],
  platform: ['broker', 'account', 'source'],
  sector: ['industry'],
};

/** Required columns; `sector` is optional. */
export const REQUIRED_COLUMNS: readonly CsvColumn[] = CSV_COLUMNS.filter((c) => c !== 'sector');

const LOOKUP = new Map<string, CsvColumn>();
for (const col of CSV_COLUMNS) {
  LOOKUP.set(norm(col), col);
  for (const a of HEADER_ALIASES[col]) LOOKUP.set(norm(a), col);
}

/** Canonical column for a header (case/space/underscore-insensitive), or `null`. */
export function resolveHeader(header: string): CsvColumn | null {
  return LOOKUP.get(norm(header)) ?? null;
}

/** Closest canonical column for an unknown header within edit distance 2 (for "rename" fixes). */
export function closeHeaderMatch(header: string): CsvColumn | null {
  const h = norm(header);
  let best: { col: CsvColumn; d: number } | null = null;
  for (const [name, col] of LOOKUP) {
    const d = editDistance(h, name, 2);
    if (d <= 2 && (best === null || d < best.d)) best = { col, d };
  }
  return best?.col ?? null;
}

const EXCHANGE_ALIASES: Readonly<Record<string, Exchange>> = {
  NSE: 'NSE',
  BSE: 'BSE',
  NASDAQ: 'NASDAQ',
  NASDAQGS: 'NASDAQ',
  NASDAQGM: 'NASDAQ',
  NASDAQCM: 'NASDAQ',
  NYSE: 'NYSE',
  NYSEARCA: 'NYSE_ARCA',
  ARCA: 'NYSE_ARCA',
  NYSEAMERICAN: 'NYSE_AMERICAN',
  AMEX: 'NYSE_AMERICAN',
  CBOE: 'CBOE',
  BATS: 'CBOE',
  CBOEBZX: 'CBOE',
};

/** Normalises an exchange cell (`nasdaq gs`, `NYSEARCA`, `nyse_arca` …) or returns `null`. */
export function normaliseExchange(raw: string): Exchange | null {
  return EXCHANGE_ALIASES[raw.toUpperCase().replace(/[\s_-]+/g, '')] ?? null;
}

/**
 * Parses a positive number allowing thousands separators, spaces and a leading ₹/$.
 * Returns `null` for anything else (including zero, negatives and stray characters).
 */
export function parsePositiveNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^[₹$]\s*/, '')
    .replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Outcome of reading a date cell. */
export type DateCheck =
  | { readonly ok: true; readonly date: IsoDate }
  | {
      readonly ok: false;
      readonly code:
        'CSV_BAD_DATE' | 'CSV_AMBIGUOUS_DATE' | 'CSV_DATE_FORMAT' | 'CSV_FUTURE_DATE' | 'CSV_DATE_TOO_OLD';
      readonly message: string;
      readonly suggestion: string | null;
    };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;

const badDate: DateCheck = {
  ok: false,
  code: 'CSV_BAD_DATE',
  message: 'Not a valid date.',
  suggestion: 'Use YYYY-MM-DD, e.g. `2024-03-15`',
};

function formatFix(candidate: string): DateCheck {
  if (!isValidCalendarDate(candidate)) return badDate;
  return {
    ok: false,
    code: 'CSV_DATE_FORMAT',
    message: 'Dates must be written as YYYY-MM-DD.',
    suggestion: `Use \`${candidate}\``,
  };
}

/**
 * Reads a buy_date cell (LLD §2.9). Only ISO dates are accepted; other formats produce an error
 * with the ISO rewrite as the fix (never auto-converted, so the file stays the source of truth).
 * `dd/mm` vs `mm/dd` with both parts ≤ 12 is reported as ambiguous with both options.
 */
export function checkDate(raw: string, today: IsoDate): DateCheck {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (!isValidCalendarDate(s)) return badDate;
    if (s > today)
      return { ok: false, code: 'CSV_FUTURE_DATE', message: 'Buy date is in the future.', suggestion: null };
    if (s < MIN_TRADE_DATE) {
      return {
        ok: false,
        code: 'CSV_DATE_TOO_OLD',
        message: `Buy date is before ${MIN_TRADE_DATE}.`,
        suggestion: null,
      };
    }
    return { ok: true, date: s };
  }

  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s);
  if (m) return formatFix(iso(Number(m[1]), Number(m[2]), Number(m[3])));

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12 && b <= 12) return formatFix(iso(y, b, a));
    if (b > 12 && a <= 12) return formatFix(iso(y, a, b));
    if (a === b) return formatFix(iso(y, a, b));
    if (a <= 12 && b <= 12) {
      const dmy = iso(y, b, a);
      const mdy = iso(y, a, b);
      return {
        ok: false,
        code: 'CSV_AMBIGUOUS_DATE',
        message: 'This date could be day-first or month-first.',
        suggestion: `Write it as \`${dmy}\` or \`${mdy}\``,
      };
    }
    return badDate;
  }

  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{4})$/.exec(s) ?? null;
  if (m) {
    const month = MONTHS.indexOf((m[2] ?? '').slice(0, 3).toLowerCase()) + 1;
    return month > 0 ? formatFix(iso(Number(m[3]), month, Number(m[1]))) : badDate;
  }
  m = /^([A-Za-z]{3,9})[\s-](\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf((m[1] ?? '').slice(0, 3).toLowerCase()) + 1;
    return month > 0 ? formatFix(iso(Number(m[3]), month, Number(m[2]))) : badDate;
  }
  return badDate;
}
