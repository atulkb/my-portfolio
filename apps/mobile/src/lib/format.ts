import type { Currency, IsoDate } from '@portfolio/core';

/**
 * Number and date formatting (LLD §4.5): the only place numbers become text. INR uses Indian
 * grouping (₹49,04,360.00), USD US grouping; 2 decimals for money and %; `null` → "—".
 */
const MONEY: Readonly<Record<Currency, Intl.NumberFormat>> = {
  INR: new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

/** Currency symbol shown in input prefixes. */
export const CURRENCY_SYMBOL: Readonly<Record<Currency, string>> = { INR: '₹', USD: '$' };

/** Money in its native currency, e.g. `₹2,52,000.00`, `$4,236.00`. */
export function formatMoney(amount: number | null, currency: Currency): string {
  return amount === null || !Number.isFinite(amount) ? '—' : MONEY[currency].format(amount);
}

const QTY_IN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const QTY_US = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

/** Share quantity: whole numbers for India, up to 4 decimals for US. */
export function formatQuantity(qty: number, currency: Currency): string {
  return (currency === 'INR' ? QTY_IN : QTY_US).format(qty);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date as "15 Oct 2026" (or "15 Oct" with `short`). Invalid input is returned unchanged. */
export function formatDate(iso: IsoDate, opts: { readonly short?: boolean } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const day = String(Number(m[3]));
  const month = MONTHS[Number(m[2]) - 1] ?? '';
  return opts.short ? `${day} ${month}` : `${day} ${month} ${m[1]}`;
}
