import type { Fundamentals } from '../market/types';
import { round } from '../util/numbers';
import { THRESHOLDS } from './thresholds';
import type { ParamKey, ParamLevel } from './types';

const n1 = (v: number): string => String(round(v, 1));
const n2 = (v: number): string => String(round(v, 2));
const pct = (v: number): string => `${n1(v)}%`;
const signedPct = (v: number): string => `${n1(Math.abs(v))}%`;

type Template = (value: number, level: Exclude<ParamLevel, 'NA'>, f: Fundamentals | null) => string;

const growthBasis = (f: Fundamentals | null): string => (f?.growthBasis === 'CAGR3Y' ? '3-yr CAGR' : 'YoY');
const t = THRESHOLDS;

/** One-line reason per parameter and level, quoting the value and the threshold (ANALYSIS_FRAMEWORK §1.5). */
const TEMPLATES: Readonly<Record<ParamKey, Template>> = {
  trend200: (v, l) =>
    l === 'GOOD'
      ? `Price ${signedPct(v)} above its 200-day average — long-term uptrend`
      : l === 'BAD'
        ? `Price ${signedPct(v)} below its 200-day average — long-term downtrend`
        : `Price within ${t.trend200.bandPct}% of its 200-day average`,
  cross50_200: (v, l) =>
    l === 'GOOD'
      ? `50-day average ${signedPct(v)} above the 200-day — golden-cross regime`
      : l === 'BAD'
        ? `50-day average ${signedPct(v)} below the 200-day — death-cross regime`
        : `50-day and 200-day averages within ${t.cross50_200.bandPct}%`,
  rsi14: (v, l) =>
    l === 'GOOD'
      ? v < t.rsi14.healthyLow
        ? `RSI ${n1(v)} — pullback within an uptrend`
        : `RSI ${n1(v)} — healthy momentum (${t.rsi14.healthyLow}–${t.rsi14.healthyHigh})`
      : l === 'BAD'
        ? v > t.rsi14.overbought
          ? `RSI ${n1(v)} — overbought (> ${t.rsi14.overbought})`
          : `RSI ${n1(v)} — oversold in a downtrend (< ${t.rsi14.pullbackLow})`
        : `RSI ${n1(v)} — neutral to extended momentum`,
  macd: (_v, l) =>
    l === 'GOOD'
      ? 'MACD above its signal line and above zero — positive momentum'
      : l === 'BAD'
        ? 'MACD below its signal line and below zero — negative momentum'
        : 'MACD momentum is mixed',
  range52w: (v, l) =>
    l === 'BAD'
      ? `Trading in the bottom of its 52-week range (${pct(v)})`
      : `Trading at ${pct(v)} of its 52-week range`,
  drawdown: (v, l) =>
    l === 'GOOD'
      ? `Only ${pct(v)} below its 52-week high`
      : l === 'BAD'
        ? `${pct(v)} below its 52-week high — deep correction (> ${t.drawdown.badAbove}%)`
        : `${pct(v)} below its 52-week high`,
  volatility: (v, l) =>
    l === 'GOOD'
      ? `Annualised volatility ${pct(v)} — relatively stable (< ${t.volatility.goodBelow}%)`
      : l === 'BAD'
        ? `Annualised volatility ${pct(v)} — high risk (> ${t.volatility.badAbove}%)`
        : `Annualised volatility ${pct(v)}`,
  volumeTrend: (v, l) =>
    l === 'GOOD'
      ? `Up-day volume ${n2(v)}× its 90-day norm — strong conviction`
      : l === 'BAD'
        ? `Up-day volume ${n2(v)}× its 90-day norm — weak conviction`
        : `Up-day volume ${n2(v)}× its 90-day norm`,
  pe: (v, l) =>
    v < 0
      ? `Negative earnings (P/E ${n1(v)})`
      : l === 'GOOD'
        ? `P/E ${n1(v)} — reasonably valued (< ${t.pe.goodBelow})`
        : l === 'BAD'
          ? `P/E ${n1(v)} — expensive (> ${t.pe.badAbove})`
          : `P/E ${n1(v)}`,
  peg: (v, l) =>
    v < 0
      ? `Negative PEG (${n2(v)}) — earnings shrinking`
      : l === 'GOOD'
        ? `PEG ${n2(v)} — cheap for its growth (< ${t.peg.goodBelow})`
        : l === 'BAD'
          ? `PEG ${n2(v)} — expensive for its growth (> ${t.peg.badAbove})`
          : `PEG ${n2(v)}`,
  pb: (v, l) =>
    v < 0
      ? `Negative book value (P/B ${n2(v)})`
      : l === 'GOOD'
        ? `P/B ${n2(v)} — modest premium to book value`
        : l === 'BAD'
          ? `P/B ${n2(v)} — high premium to book value`
          : `P/B ${n2(v)}`,
  roe: (v, l) =>
    l === 'GOOD'
      ? `ROE ${pct(v)} — strong return on shareholder capital (> ${t.roe.goodAbove}%)`
      : l === 'BAD'
        ? `ROE ${pct(v)} — weak return on shareholder capital (< ${t.roe.badBelow}%)`
        : `ROE ${pct(v)}`,
  roce: (v, l) =>
    l === 'GOOD'
      ? `ROCE ${pct(v)} — efficient use of capital (> ${t.roce.goodAbove}%)`
      : l === 'BAD'
        ? `ROCE ${pct(v)} — poor use of capital (< ${t.roce.badBelow}%)`
        : `ROCE ${pct(v)}`,
  de: (v, l) =>
    l === 'GOOD'
      ? `Debt/Equity ${n2(v)} — low leverage`
      : l === 'BAD'
        ? `Debt/Equity ${n2(v)} — high leverage`
        : `Debt/Equity ${n2(v)}`,
  currentRatio: (v, l) =>
    l === 'GOOD'
      ? `Current ratio ${n2(v)} — comfortable short-term liquidity`
      : l === 'BAD'
        ? `Current ratio ${n2(v)} — tight short-term liquidity (< ${t.currentRatio.badBelow})`
        : `Current ratio ${n2(v)}`,
  interestCoverage: (v, l) =>
    l === 'GOOD'
      ? `Interest covered ${n1(v)}× by operating profit`
      : l === 'BAD'
        ? `Interest covered only ${n1(v)}× by operating profit`
        : `Interest covered ${n1(v)}×`,
  revenueGrowth: (v, l, f) =>
    l === 'GOOD'
      ? `Revenue growth ${pct(v)} (${growthBasis(f)}) — expanding business`
      : l === 'BAD'
        ? `Revenue growth ${pct(v)} (${growthBasis(f)}) — slow or shrinking`
        : `Revenue growth ${pct(v)} (${growthBasis(f)})`,
  epsGrowth: (v, l, f) =>
    l === 'GOOD'
      ? `EPS growth ${pct(v)} (${growthBasis(f)}) — earnings expanding`
      : l === 'BAD'
        ? `EPS growth ${pct(v)} (${growthBasis(f)}) — earnings weak or shrinking`
        : `EPS growth ${pct(v)} (${growthBasis(f)})`,
  netMargin: (v, l) =>
    l === 'GOOD'
      ? `Net margin ${pct(v)} — highly profitable (> ${t.netMargin.goodAbove}%)`
      : l === 'BAD'
        ? `Net margin ${pct(v)} — thin or negative profitability`
        : `Net margin ${pct(v)}`,
  fcf: (v, l) =>
    l === 'GOOD'
      ? 'Positive and growing free cash flow'
      : l === 'BAD'
        ? 'Negative free cash flow'
        : 'Positive free cash flow',
  promoterHolding: (v, l) =>
    l === 'GOOD'
      ? `Promoters hold ${pct(v)} with no pledged shares`
      : l === 'BAD'
        ? `Significant promoter share pledging (> ${t.promoter.badPledgeAbove}%)`
        : `Promoter holding ${pct(v)}`,
};

/** Reason text for a parameter; "Insufficient data" when not available. */
export function reasonFor(
  key: ParamKey,
  value: number | null,
  level: ParamLevel,
  f: Fundamentals | null,
): string {
  if (level === 'NA' || value === null) return 'Insufficient data';
  return TEMPLATES[key](value, level, f);
}
