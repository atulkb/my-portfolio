import { MACD, RSI } from 'technicalindicators';
import type { DailyBar } from '../market/types';
import { addDays } from '../util/dates';
import { computeIndicators, looksLikeSplit } from './compute';

/** Deterministic synthetic series: trend + wave, volume higher on up-days. */
function series(n: number, opts: { start?: number; slope?: number } = {}): DailyBar[] {
  const { start = 100, slope = 0.1 } = opts;
  const bars: DailyBar[] = [];
  let prevClose = start;
  for (let i = 0; i < n; i++) {
    const close = start + i * slope + Math.sin(i / 4) * 3;
    bars.push({
      date: addDays('2025-01-01', i),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      adjClose: close,
      volume: close > prevClose ? 2000 : 1000,
    });
    prevClose = close;
  }
  return bars;
}

describe('computeIndicators', () => {
  const bars = series(260);
  const ind = computeIndicators(bars);
  const adj = bars.map((b) => b.adjClose);

  it('matches technicalindicators for RSI and MACD', () => {
    expect(ind.rsi14).toBeCloseTo(RSI.calculate({ period: 14, values: adj }).at(-1) as number, 6);
    const macd = MACD.calculate({
      values: adj,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    expect(ind.macd).toBeCloseTo(macd.at(-1)?.MACD as number, 9);
    expect(ind.macdSignalPrev).toBeCloseTo(macd.at(-2)?.signal as number, 9);
  });

  it('computes SMAs and their previous-session values', () => {
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(ind.sma20).toBeCloseTo(mean(adj.slice(-20)), 9);
    expect(ind.sma200).toBeCloseTo(mean(adj.slice(-200)), 9);
    expect(ind.sma50Prev).toBeCloseTo(mean(adj.slice(-51, -1)), 9);
  });

  it('computes price, change, 52-week and volume values', () => {
    const last = bars.at(-1) as DailyBar;
    const prev = bars.at(-2) as DailyBar;
    expect(ind.asOf).toBe(last.date);
    expect(ind.close).toBe(last.close);
    expect(ind.changePct).toBeCloseTo((last.close / prev.close - 1) * 100, 9);
    const window = bars.slice(-252);
    expect(ind.high52w).toBeCloseTo(Math.max(...window.map((b) => b.high)), 9);
    expect(ind.low52w).toBeCloseTo(Math.min(...window.map((b) => b.low)), 9);
    expect(ind.range52wPartial).toBe(false);
    expect(ind.drawdownPct).toBeGreaterThanOrEqual(0);
    expect(ind.volatilityPct).toBeGreaterThan(0);
    expect(ind.avgVolume30).toBeGreaterThan(1000);
    expect(ind.volumeTrend).toBeCloseTo(1, 9); // up-day volume is constant
  });

  it('returns nulls below the minimum history', () => {
    const short = computeIndicators(series(14));
    expect(short.rsi14).toBeNull();
    expect(short.sma20).toBeNull();
    expect(short.macd).toBeNull();
    expect(short.volatilityPct).toBeNull();
    expect(short.avgVolume30).toBeNull();
    expect(short.volumeTrend).toBeNull();
    expect(short.range52wPartial).toBe(true);
    expect(short.high52w).not.toBeNull();

    expect(computeIndicators(series(15)).rsi14).not.toBeNull();
    expect(computeIndicators(series(34)).macdPrev).toBeNull();
    expect(computeIndicators(series(35)).macdSignalPrev).not.toBeNull();
    expect(computeIndicators(series(199)).sma200).toBeNull();
    expect(computeIndicators(series(200)).sma200Prev).toBeNull();
    expect(computeIndicators(series(201)).sma200Prev).not.toBeNull();
  });

  it('handles empty and single-bar input', () => {
    const empty = computeIndicators([]);
    expect(empty.close).toBeNull();
    expect(empty.asOf).toBeNull();
    expect(empty.high52w).toBeNull();
    const one = computeIndicators(series(1));
    expect(one.close).not.toBeNull();
    expect(one.closePrev).toBeNull();
    expect(one.changePct).toBeNull();
  });

  it('uses adjClose so a split does not crash the moving averages', () => {
    const pre = series(220, { slope: 0 });
    // 1:2 split on the last bar: raw prices halve, adjusted history is rescaled by the provider.
    const split = pre.map((b, i) =>
      i === pre.length - 1
        ? { ...b, close: b.close / 2, high: b.high / 2, low: b.low / 2, adjClose: b.close / 2 }
        : { ...b, adjClose: b.close / 2 },
    );
    const r = computeIndicators(split);
    expect(r.close).toBeCloseTo((pre.at(-1)?.close as number) / 2, 9);
    expect(r.drawdownPct as number).toBeLessThan(10); // no fake 50 % crash
    expect(looksLikeSplit(split)).toBe(true);
    expect(looksLikeSplit(pre)).toBe(false);
    expect(looksLikeSplit([])).toBe(false);
  });
});
