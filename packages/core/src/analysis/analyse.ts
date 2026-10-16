import type { Label } from '../market/types';
import type { Market } from '../models/primitives';
import { classifyFundamental, classifyTechnical, isApplicable, pctDiff, type Classified } from './classify';
import type { SectorCategory } from './sectors';
import { reasonFor } from './templates';
import { MAX_PROS_CONS, THRESHOLDS, WEIGHTS } from './thresholds';
import {
  FUNDAMENTAL_PARAMS,
  TECHNICAL_PARAMS,
  type AnalysisInput,
  type AnalysisResult,
  type MacroAssessment,
  type MacroSnapshot,
  type ParamKey,
  type ParamResult,
  type Regime,
  type VixLevel,
} from './types';

/** Weight of a parameter for a sector (ANALYSIS_FRAMEWORK §4.2, §5). */
export function weightFor(key: ParamKey, sector: SectorCategory): number {
  if (sector === 'FINANCIALS' && key in WEIGHTS.financials)
    return WEIGHTS.financials[key as keyof typeof WEIGHTS.financials];
  if (key in WEIGHTS.emphasised) return WEIGHTS.emphasised[key as keyof typeof WEIGHTS.emphasised];
  return WEIGHTS.default;
}

const SCORE: Readonly<Record<'GOOD' | 'AVERAGE' | 'BAD', number>> = { GOOD: 1, AVERAGE: 0, BAD: -1 };

/** Weighted mean of +1/0/−1 over available parameters, or `null` when none are available. */
export function groupScore(params: readonly ParamResult[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of params) {
    if (p.level === 'NA') continue;
    num += p.weight * SCORE[p.level];
    den += p.weight;
  }
  return den === 0 ? null : num / den;
}

/** Health label from a 0–100 score (≥ 65 GOOD, 40–64 AVERAGE, < 40 BAD). */
export function healthLabelFor(score: number): Label {
  const h = THRESHOLDS.health;
  if (score >= h.goodAtLeast) return 'GOOD';
  if (score < h.badBelow) return 'BAD';
  return 'AVERAGE';
}

function toParam(
  key: ParamKey,
  group: ParamResult['group'],
  c: Classified,
  input: AnalysisInput,
): ParamResult {
  const distance =
    c.value === null || c.bound === null
      ? 0
      : Math.abs(c.value - c.bound) / Math.max(Math.abs(c.bound), 1e-9);
  return {
    key,
    group,
    value: c.value,
    level: c.level,
    weight: weightFor(key, input.sectorCategory),
    reason: reasonFor(key, c.value, c.level, input.fundamentals),
    distance,
  };
}

function vixLevel(value: number | null, market: Market): VixLevel | null {
  if (value === null) return null;
  const v = THRESHOLDS.vix[market];
  if (value < v.calmBelow) return 'CALM';
  if (value > v.fearAbove) return 'FEAR';
  return 'ELEVATED';
}

function regime(index: MacroSnapshot['nifty']): { pctVsSma200: number | null; regime: Regime | null } {
  if (index === null || index.sma200 === null || index.sma200 === 0)
    return { pctVsSma200: null, regime: null };
  const pct = pctDiff(index.close, index.sma200) ?? 0;
  const band = THRESHOLDS.indexTrendBandPct;
  return { pctVsSma200: pct, regime: pct > band ? 'ABOVE' : pct < -band ? 'BELOW' : 'NEAR' };
}

/** Macro context (ANALYSIS_FRAMEWORK §6): shown with the analysis, never part of the Health score. */
export function assessMacro(macro: MacroSnapshot): MacroAssessment {
  return {
    indiaVix: { value: macro.indiaVix, level: vixLevel(macro.indiaVix, 'IN') },
    vix: { value: macro.vix, level: vixLevel(macro.vix, 'US') },
    nifty: regime(macro.nifty),
    sp500: regime(macro.sp500),
  };
}

const byStrength = (a: ParamResult, b: ParamResult): number => b.weight - a.weight || b.distance - a.distance;

/**
 * Deterministic analysis (LLD §2.7): classifies every applicable parameter, computes group
 * scores and Health = 50 + 50 × (0.4 × technical + 0.6 × fundamental), using one group alone
 * when the other has no data. Health is `null` when fewer than 50 % of applicable parameters
 * have data.
 */
export function analyseInstrument(input: AnalysisInput): AnalysisResult {
  const { sectorCategory: sector, market } = input;
  const technical = TECHNICAL_PARAMS.map((k) =>
    toParam(k, 'TECHNICAL', classifyTechnical(k, input.indicators), input),
  );
  const fundamental = FUNDAMENTAL_PARAMS.filter((k) => isApplicable(k, sector, market)).map((k) =>
    toParam(k, 'FUNDAMENTAL', classifyFundamental(k, input.fundamentals, sector, market), input),
  );
  const params = [...technical, ...fundamental];

  const technicalScore = groupScore(technical);
  const fundamentalScore = groupScore(fundamental);
  const h = THRESHOLDS.health;
  const available = params.filter((p) => p.level !== 'NA').length;
  const enoughData = params.length > 0 && available / params.length >= h.minAvailableShare;

  let healthScore: number | null = null;
  if (enoughData) {
    const combined =
      technicalScore !== null && fundamentalScore !== null
        ? h.technicalWeight * technicalScore + h.fundamentalWeight * fundamentalScore
        : (technicalScore ?? fundamentalScore);
    healthScore = combined === null ? null : 50 + 50 * combined;
  }

  return {
    params,
    technicalScore,
    fundamentalScore,
    healthScore,
    healthLabel: healthScore === null ? null : healthLabelFor(healthScore),
    pros: params
      .filter((p) => p.level === 'GOOD')
      .sort(byStrength)
      .slice(0, MAX_PROS_CONS),
    cons: params
      .filter((p) => p.level === 'BAD')
      .sort(byStrength)
      .slice(0, MAX_PROS_CONS),
    macro: assessMacro(input.macro),
  };
}
