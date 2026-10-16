import type { IndicatorSet } from '../indicators/compute';
import type { Fundamentals } from '../market/types';
import type { Market } from '../models/primitives';
import { round } from '../util/numbers';
import type { SectorCategory } from './sectors';
import { THRESHOLDS } from './thresholds';
import type { ParamKey, ParamLevel } from './types';

/** Level plus the bound that decided it (for ordering pros/cons). */
export type Classified = {
  readonly level: ParamLevel;
  readonly value: number | null;
  readonly bound: number | null;
};

const NA: Classified = { level: 'NA', value: null, bound: null };

/** Higher is better: > goodAbove GOOD, < badBelow BAD, else AVERAGE (strict bounds). */
export function higherIsBetter(value: number | null, goodAbove: number, badBelow: number): Classified {
  if (value === null) return NA;
  if (value > goodAbove) return { level: 'GOOD', value, bound: goodAbove };
  if (value < badBelow) return { level: 'BAD', value, bound: badBelow };
  return { level: 'AVERAGE', value, bound: null };
}

/** Lower is better: < goodBelow GOOD, > badAbove BAD, else AVERAGE (strict bounds). */
export function lowerIsBetter(value: number | null, goodBelow: number, badAbove: number): Classified {
  if (value === null) return NA;
  if (value < goodBelow) return { level: 'GOOD', value, bound: goodBelow };
  if (value > badAbove) return { level: 'BAD', value, bound: badAbove };
  return { level: 'AVERAGE', value, bound: null };
}

/** Valuation ratio where negative means losses (always BAD). */
function valuation(value: number | null, t: { goodBelow: number; badAbove: number }): Classified {
  if (value !== null && value < 0) return { level: 'BAD', value, bound: 0 };
  return lowerIsBetter(value, t.goodBelow, t.badAbove);
}

/** Price vs average as a % difference, with an AVERAGE band of ±bandPct. */
function versusAverage(value: number | null, bandPct: number): Classified {
  if (value === null) return NA;
  if (value > bandPct) return { level: 'GOOD', value, bound: bandPct };
  if (value < -bandPct) return { level: 'BAD', value, bound: -bandPct };
  return { level: 'AVERAGE', value, bound: null };
}

/**
 * Percentage difference of `a` over `b`, rounded to 6 dp so float noise (102/100 − 1 =
 * 0.020000000000000018) cannot push a value exactly on a band edge across it.
 */
export const pctDiff = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : round((a / b - 1) * 100, 6);

/** Classifies one technical parameter (ANALYSIS_FRAMEWORK §2). */
export function classifyTechnical(key: ParamKey, ind: IndicatorSet): Classified {
  const t = THRESHOLDS;
  const trend = pctDiff(ind.close, ind.sma200);
  switch (key) {
    case 'trend200':
      return versusAverage(trend, t.trend200.bandPct);
    case 'cross50_200':
      return versusAverage(pctDiff(ind.sma50, ind.sma200), t.cross50_200.bandPct);
    case 'rsi14': {
      const rsi = ind.rsi14;
      if (rsi === null) return NA;
      const r = t.rsi14;
      const upTrend = trend !== null && trend > 0;
      const downTrend = trend !== null && trend < 0;
      if (rsi > r.overbought) return { level: 'BAD', value: rsi, bound: r.overbought };
      if (rsi < r.pullbackLow) {
        return downTrend
          ? { level: 'BAD', value: rsi, bound: r.pullbackLow }
          : { level: 'AVERAGE', value: rsi, bound: null };
      }
      if (rsi >= r.healthyLow && rsi <= r.healthyHigh)
        return { level: 'GOOD', value: rsi, bound: r.healthyLow };
      if (rsi < r.healthyLow) {
        return upTrend
          ? { level: 'GOOD', value: rsi, bound: r.pullbackLow }
          : { level: 'AVERAGE', value: rsi, bound: null };
      }
      return { level: 'AVERAGE', value: rsi, bound: null }; // 60 < rsi ≤ 70
    }
    case 'macd': {
      if (ind.macd === null || ind.macdSignal === null) return NA;
      const above = ind.macd > ind.macdSignal;
      if (above && ind.macd > 0) return { level: 'GOOD', value: ind.macd, bound: 0 };
      if (!above && ind.macd < 0) return { level: 'BAD', value: ind.macd, bound: 0 };
      return { level: 'AVERAGE', value: ind.macd, bound: null };
    }
    case 'range52w': {
      const v = ind.range52wPct;
      if (v === null) return NA;
      const r = t.range52w;
      if (v >= r.goodLow && v <= r.goodHigh) return { level: 'GOOD', value: v, bound: r.goodLow };
      if (v < r.badBelow) return { level: 'BAD', value: v, bound: r.badBelow };
      return { level: 'AVERAGE', value: v, bound: null };
    }
    case 'drawdown':
      return lowerIsBetter(ind.drawdownPct, t.drawdown.goodBelow, t.drawdown.badAbove);
    case 'volatility':
      return lowerIsBetter(ind.volatilityPct, t.volatility.goodBelow, t.volatility.badAbove);
    case 'volumeTrend':
      return higherIsBetter(ind.volumeTrend, t.volumeTrend.goodAbove, t.volumeTrend.badBelow);
    default:
      return NA;
  }
}

/** Classifies one fundamental parameter (ANALYSIS_FRAMEWORK §3, §5). */
export function classifyFundamental(
  key: ParamKey,
  f: Fundamentals | null,
  sector: SectorCategory,
  market: Market,
): Classified {
  if (f === null) return NA;
  const t = THRESHOLDS;
  switch (key) {
    case 'pe':
      return valuation(f.pe, t.pe);
    case 'peg':
      return valuation(f.peg, t.peg);
    case 'pb':
      return valuation(f.pb, t.pb);
    case 'roe':
      return higherIsBetter(f.roePct, t.roe.goodAbove, t.roe.badBelow);
    case 'roce':
      return higherIsBetter(f.roce, t.roce.goodAbove, t.roce.badBelow);
    case 'de': {
      const d = sector === 'UTILITIES_REAL_ESTATE' ? t.deRelaxed : t.de;
      return lowerIsBetter(f.de, d.goodBelow, d.badAbove);
    }
    case 'currentRatio':
      return higherIsBetter(f.currentRatio, t.currentRatio.goodAbove, t.currentRatio.badBelow);
    case 'interestCoverage':
      return higherIsBetter(f.interestCoverage, t.interestCoverage.goodAbove, t.interestCoverage.badBelow);
    case 'revenueGrowth':
      return higherIsBetter(f.revenueGrowthPct, t.revenueGrowth.goodAbove, t.revenueGrowth.badBelow);
    case 'epsGrowth':
      return higherIsBetter(f.epsGrowthPct, t.epsGrowth.goodAbove, t.epsGrowth.badBelow);
    case 'netMargin': {
      if (f.netMarginPct !== null && f.netMarginPct < 0)
        return { level: 'BAD', value: f.netMarginPct, bound: 0 };
      return higherIsBetter(f.netMarginPct, t.netMargin.goodAbove, t.netMargin.badBelow);
    }
    case 'fcf': {
      if (f.fcf === null) return NA;
      const { ttm, trend } = f.fcf;
      if (ttm < 0) return { level: 'BAD', value: ttm, bound: 0 };
      // Unknown trend counts as "positive, flat" → AVERAGE, never GOOD (LLD §3.3).
      return trend === 'GROWING'
        ? { level: 'GOOD', value: ttm, bound: 0 }
        : { level: 'AVERAGE', value: ttm, bound: null };
    }
    case 'promoterHolding': {
      if (market !== 'IN' || f.promoterHoldingPct === null) return NA;
      const p = t.promoter;
      const holding = f.promoterHoldingPct;
      const pledge = f.pledgePct;
      if (pledge !== null && pledge > p.badPledgeAbove)
        return { level: 'BAD', value: holding, bound: p.badPledgeAbove };
      if (holding > p.goodHoldingAbove && pledge === 0)
        return { level: 'GOOD', value: holding, bound: p.goodHoldingAbove };
      return { level: 'AVERAGE', value: holding, bound: null };
    }
    default:
      return NA;
  }
}

/** Parameters skipped for a sector/market (ANALYSIS_FRAMEWORK §5); skipped ones don't count as applicable. */
export function isApplicable(key: ParamKey, sector: SectorCategory, market: Market): boolean {
  if (
    sector === 'FINANCIALS' &&
    (key === 'de' || key === 'currentRatio' || key === 'roce' || key === 'interestCoverage')
  ) {
    return false;
  }
  if (key === 'promoterHolding' && market !== 'IN') return false;
  return true;
}
