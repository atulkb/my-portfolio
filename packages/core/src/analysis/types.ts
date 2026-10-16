import type { IndicatorSet } from '../indicators/compute';
import type { Fundamentals, Label } from '../market/types';
import type { Market } from '../models/primitives';
import type { SectorCategory } from './sectors';

/** Scored parameters (ANALYSIS_FRAMEWORK §2–§3). Dividend yield is informational and not listed. */
export const TECHNICAL_PARAMS = [
  'trend200',
  'cross50_200',
  'rsi14',
  'macd',
  'range52w',
  'drawdown',
  'volatility',
  'volumeTrend',
] as const;
export const FUNDAMENTAL_PARAMS = [
  'pe',
  'peg',
  'pb',
  'roe',
  'roce',
  'de',
  'currentRatio',
  'interestCoverage',
  'revenueGrowth',
  'epsGrowth',
  'netMargin',
  'fcf',
  'promoterHolding',
] as const;

/** Key of a scored parameter. */
export type ParamKey = (typeof TECHNICAL_PARAMS)[number] | (typeof FUNDAMENTAL_PARAMS)[number];

/** Classification of one parameter; NA = insufficient data (excluded from scores). */
export type ParamLevel = 'GOOD' | 'AVERAGE' | 'BAD' | 'NA';

/** One scored parameter with its templated reason. */
export type ParamResult = {
  readonly key: ParamKey;
  readonly group: 'TECHNICAL' | 'FUNDAMENTAL';
  readonly value: number | null;
  readonly level: ParamLevel;
  readonly weight: number;
  readonly reason: string;
  /** Relative distance past the threshold that decided the level (orders pros/cons). */
  readonly distance: number;
};

/** Macro inputs (ANALYSIS_FRAMEWORK §6). */
export type MacroSnapshot = {
  readonly indiaVix: number | null;
  readonly vix: number | null;
  readonly nifty: { readonly close: number; readonly sma200: number | null } | null;
  readonly sp500: { readonly close: number; readonly sma200: number | null } | null;
};

/** VIX bucket. */
export type VixLevel = 'CALM' | 'ELEVATED' | 'FEAR';
/** Index position vs its 200-day average. */
export type Regime = 'ABOVE' | 'NEAR' | 'BELOW';

/** Macro context shown alongside (never inside) the Health score. */
export type MacroAssessment = {
  readonly indiaVix: { readonly value: number | null; readonly level: VixLevel | null };
  readonly vix: { readonly value: number | null; readonly level: VixLevel | null };
  readonly nifty: { readonly pctVsSma200: number | null; readonly regime: Regime | null };
  readonly sp500: { readonly pctVsSma200: number | null; readonly regime: Regime | null };
};

/** Inputs for {@link analyseInstrument}. */
export type AnalysisInput = {
  readonly indicators: IndicatorSet;
  readonly fundamentals: Fundamentals | null;
  readonly sectorCategory: SectorCategory;
  readonly market: Market;
  readonly macro: MacroSnapshot;
};

/** Deterministic analysis of one instrument (LLD §2.7). */
export type AnalysisResult = {
  /** Applicable parameters only (sector skips removed). */
  readonly params: readonly ParamResult[];
  readonly technicalScore: number | null;
  readonly fundamentalScore: number | null;
  /** 0–100; `null` when fewer than 50 % of applicable parameters have data. */
  readonly healthScore: number | null;
  readonly healthLabel: Label | null;
  readonly pros: readonly ParamResult[];
  readonly cons: readonly ParamResult[];
  readonly macro: MacroAssessment;
};
