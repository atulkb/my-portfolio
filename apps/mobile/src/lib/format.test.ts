import { dateFromIso, localIsoDate } from './dates';
import {
  formatDate,
  formatFxRate,
  formatMoney,
  formatPct,
  formatQuantity,
  formatSignedMoney,
} from './format';

describe('format', () => {
  it('uses Indian grouping for INR and US grouping for USD', () => {
    expect(formatMoney(4904360, 'INR')).toBe('₹49,04,360.00');
    expect(formatMoney(92144.675, 'USD')).toBe('$92,144.68');
    expect(formatMoney(-1250.5, 'INR')).toBe('-₹1,250.50');
  });

  it('shows — for missing values', () => {
    expect(formatMoney(null, 'INR')).toBe('—');
    expect(formatMoney(Number.NaN, 'USD')).toBe('—');
  });

  it('formats quantities per market', () => {
    expect(formatQuantity(1500, 'INR')).toBe('1,500');
    expect(formatQuantity(12.35, 'USD')).toBe('12.35');
    expect(formatQuantity(0.12345, 'USD')).toBe('0.1235');
  });

  it('formats dates', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026');
    expect(formatDate('2026-10-05', { short: true })).toBe('5 Oct');
    expect(formatDate('garbage')).toBe('garbage');
  });

  it('round-trips local dates', () => {
    expect(localIsoDate(new Date(2024, 2, 5))).toBe('2024-03-05');
    expect(localIsoDate(dateFromIso('2024-12-31'))).toBe('2024-12-31');
  });

  it('formats signed changes and percentages', () => {
    expect(formatSignedMoney(1401, 'INR')).toBe('+₹1,401.00');
    expect(formatSignedMoney(-12.5, 'USD')).toBe('-$12.50');
    expect(formatSignedMoney(0, 'USD')).toBe('$0.00');
    expect(formatPct(14.304, { signed: true })).toBe('+14.30%');
    expect(formatPct(-1.18)).toBe('-1.18%');
    expect(formatPct(null)).toBe('—');
    expect(formatFxRate(94.96)).toBe('1 USD ≈ ₹94.96');
    expect(formatFxRate(Number.NaN)).toBe('');
  });
});
