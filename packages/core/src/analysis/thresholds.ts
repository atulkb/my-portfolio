/**
 * Every analysis threshold, mirroring docs/ANALYSIS_FRAMEWORK.md §2–§6. No threshold literal
 * appears anywhere else. Good/bad bounds are strict: a value exactly on a bound is AVERAGE.
 */
export const THRESHOLDS = {
  // §2 technical
  trend200: { bandPct: 2 },
  cross50_200: { bandPct: 1 },
  rsi14: { healthyLow: 40, healthyHigh: 60, pullbackLow: 30, overbought: 70 },
  range52w: { goodLow: 50, goodHigh: 90, badBelow: 25 },
  drawdown: { goodBelow: 10, badAbove: 25 },
  volatility: { goodBelow: 25, badAbove: 40 },
  volumeTrend: { goodAbove: 1.2, badBelow: 0.8 },
  // §3 fundamental (v1: absolute fallbacks for valuation, LLD §2.7)
  pe: { goodBelow: 20, badAbove: 35 },
  peg: { goodBelow: 1, badAbove: 2 },
  /** Not in the framework (it is sector-relative only); v1 absolute fallback, pending review. */
  pb: { goodBelow: 1.5, badAbove: 3 },
  roe: { goodAbove: 15, badBelow: 10 },
  roce: { goodAbove: 15, badBelow: 10 },
  de: { goodBelow: 0.5, badAbove: 1 },
  /** §5 relaxed D/E for utilities and real estate. */
  deRelaxed: { goodBelow: 1, badAbove: 2 },
  currentRatio: { goodAbove: 1.5, badBelow: 1 },
  interestCoverage: { goodAbove: 5, badBelow: 2 },
  revenueGrowth: { goodAbove: 15, badBelow: 5 },
  epsGrowth: { goodAbove: 15, badBelow: 5 },
  netMargin: { goodAbove: 15, badBelow: 5 },
  promoter: { goodHoldingAbove: 50, averageHoldingAbove: 30, badPledgeAbove: 10 },
  // §4.2 health
  health: {
    technicalWeight: 0.4,
    fundamentalWeight: 0.6,
    goodAtLeast: 65,
    badBelow: 40,
    minAvailableShare: 0.5,
  },
  // §6 macro (shown, not scored)
  vix: { IN: { calmBelow: 15, fearAbove: 20 }, US: { calmBelow: 15, fearAbove: 25 } },
  indexTrendBandPct: 2,
} as const;

/** Parameter weights (§4.2): 1.0 unless listed; FINANCIALS emphasise P/B and ROE (§5). */
export const WEIGHTS = {
  default: 1,
  emphasised: { trend200: 1.5, roe: 1.5, de: 1.5, epsGrowth: 1.5 },
  financials: { pb: 2, roe: 2 },
} as const;

/** Maximum pros and cons listed (LLD §2.7). */
export const MAX_PROS_CONS = 5;
