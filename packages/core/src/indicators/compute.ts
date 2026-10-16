import { MACD, RSI } from 'technicalindicators';
import type { DailyBar } from '../market/types';
import type { IsoDate } from '../models/primitives';
import { mean, pctChange, sampleStdev } from '../util/numbers';

/** Deterministic technical values for one instrument (LLD §2.6). `null` = not enough history. */
export type IndicatorSet = {
  readonly asOf: IsoDate | null;
  readonly close: number | null;
  readonly closePrev: number | null;
  readonly changePct: number | null;
  readonly sma20: number | null;
  readonly sma50: number | null;
  readonly sma200: number | null;
  readonly sma20Prev: number | null;
  readonly sma50Prev: number | null;
  readonly sma200Prev: number | null;
  readonly rsi14: number | null;
  readonly macd: number | null;
  readonly macdSignal: number | null;
  readonly macdPrev: number | null;
  readonly macdSignalPrev: number | null;
  readonly high52w: number | null;
  readonly low52w: number | null;
  readonly range52wPct: number | null;
  readonly drawdownPct: number | null;
  /** True when the 52-week values use fewer than 252 sessions. */
  readonly range52wPartial: boolean;
  readonly volatilityPct: number | null;
  readonly volume: number | null;
  readonly avgVolume30: number | null;
  readonly volumeTrend: number | null;
};

/** Minimum sessions per indicator; below these the value is `null`. */
export const INDICATOR_MIN_BARS = {
  rsi14: 15,
  macdWithPrev: 35,
  range52w: 252,
  volatility: 60,
  avgVolume30: 30,
  volumeTrend: 91,
} as const;

const YEAR_SESSIONS = 252;

/** Simple moving average of the `n` values ending `offset` elements before the end. */
function sma(values: readonly number[], n: number, offset = 0): number | null {
  const end = values.length - offset;
  if (end - n < 0) return null;
  return mean(values.slice(end - n, end));
}

function upDayVolumeMean(adj: readonly number[], vol: readonly number[], days: number): number | null {
  const picked: number[] = [];
  for (let i = adj.length - days; i < adj.length; i++) {
    const today = adj[i];
    const yesterday = adj[i - 1];
    const v = vol[i];
    if (today !== undefined && yesterday !== undefined && v !== undefined && today > yesterday)
      picked.push(v);
  }
  return mean(picked);
}

/**
 * Computes every indicator from ascending daily bars. Price indicators use `adjClose` so splits
 * and dividends don't create fake moves; `close`/`closePrev` are as traded. 52-week high/low use
 * highs/lows scaled by each bar's adjustment factor.
 */
export function computeIndicators(bars: readonly DailyBar[]): IndicatorSet {
  const n = bars.length;
  const last = bars[n - 1];
  const prev = bars[n - 2];
  const adj = bars.map((b) => b.adjClose);
  const vol = bars.map((b) => b.volume);

  let rsi14: number | null = null;
  if (n >= INDICATOR_MIN_BARS.rsi14) rsi14 = RSI.calculate({ period: 14, values: adj }).at(-1) ?? null;

  let macd: number | null = null;
  let macdSignal: number | null = null;
  let macdPrev: number | null = null;
  let macdSignalPrev: number | null = null;
  if (n >= INDICATOR_MIN_BARS.macdWithPrev) {
    const out = MACD.calculate({
      values: adj,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const cur = out.at(-1);
    const before = out.at(-2);
    macd = cur?.MACD ?? null;
    macdSignal = cur?.signal ?? null;
    macdPrev = before?.MACD ?? null;
    macdSignalPrev = before?.signal ?? null;
  }

  const window = bars.slice(-YEAR_SESSIONS);
  let high52w: number | null = null;
  let low52w: number | null = null;
  if (window.length >= 2) {
    const factor = (b: DailyBar): number => (b.close > 0 ? b.adjClose / b.close : 1);
    high52w = Math.max(...window.map((b) => b.high * factor(b)));
    low52w = Math.min(...window.map((b) => b.low * factor(b)));
  }
  const lastAdj = last?.adjClose ?? null;
  const range52wPct =
    high52w !== null && low52w !== null && lastAdj !== null && high52w > low52w
      ? ((lastAdj - low52w) / (high52w - low52w)) * 100
      : null;
  const drawdownPct =
    high52w !== null && lastAdj !== null && high52w > 0 ? ((high52w - lastAdj) / high52w) * 100 : null;

  let volatilityPct: number | null = null;
  if (n >= INDICATOR_MIN_BARS.volatility) {
    const series = adj.slice(-(YEAR_SESSIONS + 1));
    const returns: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1];
      const b = series[i];
      if (a !== undefined && b !== undefined && a > 0) returns.push(b / a - 1);
    }
    const sd = sampleStdev(returns);
    volatilityPct = sd === null ? null : sd * Math.sqrt(YEAR_SESSIONS) * 100;
  }

  let volumeTrend: number | null = null;
  if (n >= INDICATOR_MIN_BARS.volumeTrend) {
    const recent = upDayVolumeMean(adj, vol, 20);
    const base = upDayVolumeMean(adj, vol, 90);
    volumeTrend = recent !== null && base !== null && base > 0 ? recent / base : null;
  }

  return {
    asOf: last?.date ?? null,
    close: last?.close ?? null,
    closePrev: prev?.close ?? null,
    changePct: pctChange(prev?.close ?? null, last?.close ?? null),
    sma20: sma(adj, 20),
    sma50: sma(adj, 50),
    sma200: sma(adj, 200),
    sma20Prev: sma(adj, 20, 1),
    sma50Prev: sma(adj, 50, 1),
    sma200Prev: sma(adj, 200, 1),
    rsi14,
    macd,
    macdSignal,
    macdPrev,
    macdSignalPrev,
    high52w,
    low52w,
    range52wPct,
    drawdownPct,
    range52wPartial: window.length < INDICATOR_MIN_BARS.range52w,
    volatilityPct,
    volume: last?.volume ?? null,
    avgVolume30: sma(vol, INDICATOR_MIN_BARS.avgVolume30),
    volumeTrend,
  };
}

/**
 * Detects a likely stock split on the latest session: close/prevClose near 1/2, 1/3, 1/4, 1/5
 * or 1/10 while the adjusted series barely moved (LLD §2.6 known limitation hint).
 */
export function looksLikeSplit(bars: readonly DailyBar[]): boolean {
  const last = bars.at(-1);
  const prev = bars.at(-2);
  if (!last || !prev || prev.close <= 0 || prev.adjClose <= 0) return false;
  const raw = last.close / prev.close;
  const adjusted = last.adjClose / prev.adjClose;
  if (Math.abs(adjusted - 1) > 0.15) return false;
  return [2, 3, 4, 5, 10].some((k) => Math.abs(raw - 1 / k) < 0.03 / k);
}
