import type { Currency, ParamKey, ParamResult } from '@portfolio/core';

import { formatMoney, formatPct } from '@/lib/format';

/** Display names of the scored parameters (S04 Fundamentals / Technicals tabs). */
export const PARAM_LABEL: Readonly<Record<ParamKey, string>> = {
  trend200: 'Price vs 200-day average',
  cross50_200: '50-day vs 200-day average',
  rsi14: 'RSI (14)',
  macd: 'MACD',
  range52w: 'Position in 52-week range',
  drawdown: 'Below 52-week high',
  volatility: 'Volatility (annualised)',
  volumeTrend: 'Volume on up-days',
  pe: 'P/E',
  peg: 'PEG',
  pb: 'P/B',
  roe: 'Return on equity',
  roce: 'Return on capital employed',
  de: 'Debt / equity',
  currentRatio: 'Current ratio',
  interestCoverage: 'Interest coverage',
  revenueGrowth: 'Revenue growth',
  epsGrowth: 'EPS growth',
  netMargin: 'Net margin',
  fcf: 'Free cash flow (TTM)',
  promoterHolding: 'Promoter holding',
};

const ratio = (v: number, suffix = ''): string => `${v.toFixed(2)}${suffix}`;

/** Parameter value as text ("22.10%", "18.40x", "—" for missing). */
export function formatParamValue(p: ParamResult, currency: Currency): string {
  const v = p.value;
  if (v === null) return '—';
  switch (p.key) {
    case 'trend200':
    case 'cross50_200':
      return formatPct(v, { signed: true });
    case 'range52w':
    case 'drawdown':
    case 'volatility':
    case 'roe':
    case 'roce':
    case 'revenueGrowth':
    case 'epsGrowth':
    case 'netMargin':
    case 'promoterHolding':
      return formatPct(v);
    case 'pe':
    case 'pb':
    case 'interestCoverage':
    case 'volumeTrend':
      return ratio(v, 'x');
    case 'fcf':
      return formatMoney(v, currency);
    case 'rsi14':
      return v.toFixed(1);
    default:
      return ratio(v);
  }
}
