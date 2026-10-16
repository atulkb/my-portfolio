import type { AnalysisResult, MacroSnapshot } from '../analysis/types';
import type { IndicatorSet } from '../indicators/compute';
import type { Fundamentals, Label } from '../market/types';
import type { Exchange, Market } from '../models/primitives';
import type { RuleContext } from './evaluate';

/** Everything known about one instrument when evaluating rules. */
export type RuleContextInput = {
  readonly indicators: IndicatorSet;
  readonly fundamentals: Fundamentals | null;
  readonly analysis: Pick<AnalysisResult, 'healthScore' | 'healthLabel'> | null;
  readonly macro: MacroSnapshot;
  readonly sector: string | null;
  readonly market: Market;
  readonly exchange: Exchange;
  /** Portfolio scope only. */
  readonly holding?: { readonly pnlPct: number | null; readonly performance: Label | null };
  /** Watchlist scope only. */
  readonly watchItem?: { readonly targetEntryPrice: number | null; readonly targetExitPrice: number | null };
};

/** Flattens an instrument's data into the whitelisted rule variables (LLD §2.8). */
export function buildRuleContext(i: RuleContextInput): RuleContext {
  const ind = i.indicators;
  const f = i.fundamentals;
  return {
    close: ind.close,
    closePrev: ind.closePrev,
    sma20: ind.sma20,
    sma50: ind.sma50,
    sma200: ind.sma200,
    sma20Prev: ind.sma20Prev,
    sma50Prev: ind.sma50Prev,
    sma200Prev: ind.sma200Prev,
    high52w: ind.high52w,
    low52w: ind.low52w,
    drawdownPct: ind.drawdownPct,
    changePct: ind.changePct,
    rsi14: ind.rsi14,
    macd: ind.macd,
    macdSignal: ind.macdSignal,
    macdPrev: ind.macdPrev,
    macdSignalPrev: ind.macdSignalPrev,
    volume: ind.volume,
    avgVolume30: ind.avgVolume30,
    volatilityPct: ind.volatilityPct,
    pe: f?.pe ?? null,
    pb: f?.pb ?? null,
    peg: f?.peg ?? null,
    roe: f?.roePct ?? null,
    de: f?.de ?? null,
    revenueGrowthPct: f?.revenueGrowthPct ?? null,
    epsGrowthPct: f?.epsGrowthPct ?? null,
    netMarginPct: f?.netMarginPct ?? null,
    dividendYieldPct: f?.dividendYieldPct ?? null,
    healthScore: i.analysis?.healthScore ?? null,
    healthLabel: i.analysis?.healthLabel ?? null,
    performanceLabel: i.holding?.performance ?? null,
    pnlPct: i.holding?.pnlPct ?? null,
    targetEntryPrice: i.watchItem?.targetEntryPrice ?? null,
    targetExitPrice: i.watchItem?.targetExitPrice ?? null,
    sector: i.sector,
    market: i.market,
    exchange: i.exchange,
    indiaVix: i.macro.indiaVix,
    vix: i.macro.vix,
  };
}
