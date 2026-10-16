import type { IndicatorSet } from '../indicators/compute';
import type { Fundamentals } from '../market/types';
import { analyseInstrument, assessMacro, groupScore, healthLabelFor, weightFor } from './analyse';
import { classifyFundamental, classifyTechnical, higherIsBetter, lowerIsBetter } from './classify';
import { sectorCategory } from './sectors';
import type { AnalysisInput, MacroSnapshot } from './types';

const emptyIndicators: IndicatorSet = {
  asOf: null,
  close: null,
  closePrev: null,
  changePct: null,
  sma20: null,
  sma50: null,
  sma200: null,
  sma20Prev: null,
  sma50Prev: null,
  sma200Prev: null,
  rsi14: null,
  macd: null,
  macdSignal: null,
  macdPrev: null,
  macdSignalPrev: null,
  high52w: null,
  low52w: null,
  range52wPct: null,
  drawdownPct: null,
  range52wPartial: true,
  volatilityPct: null,
  volume: null,
  avgVolume30: null,
  volumeTrend: null,
};

const healthyIndicators: IndicatorSet = {
  ...emptyIndicators,
  asOf: '2026-10-15',
  close: 110,
  sma50: 105,
  sma200: 100,
  rsi14: 55,
  macd: 1.2,
  macdSignal: 0.8,
  range52wPct: 70,
  drawdownPct: 5,
  volatilityPct: 20,
  volumeTrend: 1.4,
};

const emptyFundamentals: Fundamentals = {
  pe: null,
  pb: null,
  peg: null,
  roePct: null,
  roce: null,
  de: null,
  currentRatio: null,
  interestCoverage: null,
  revenueGrowthPct: null,
  epsGrowthPct: null,
  netMarginPct: null,
  fcf: null,
  dividendYieldPct: null,
  promoterHoldingPct: null,
  pledgePct: null,
  growthBasis: 'YOY',
  asOf: '2026-10-15',
  provider: 'test',
};

const goodFundamentals: Fundamentals = {
  ...emptyFundamentals,
  pe: 18,
  pb: 1.2,
  peg: 0.8,
  roePct: 22,
  roce: 20,
  de: 0.3,
  currentRatio: 2,
  interestCoverage: 9,
  revenueGrowthPct: 18,
  epsGrowthPct: 20,
  netMarginPct: 17,
  fcf: { ttm: 1000, trend: 'GROWING' },
};

const macro: MacroSnapshot = {
  indiaVix: 14,
  vix: 22,
  nifty: { close: 102, sma200: 100 },
  sp500: { close: 95, sma200: 100 },
};

const input = (p: Partial<AnalysisInput> = {}): AnalysisInput => ({
  indicators: healthyIndicators,
  fundamentals: goodFundamentals,
  sectorCategory: 'OTHER',
  market: 'US',
  macro,
  ...p,
});

describe('threshold boundaries (strict good/bad)', () => {
  it.each([
    [15, 'AVERAGE'],
    [15.01, 'GOOD'],
    [10, 'AVERAGE'],
    [9.99, 'BAD'],
  ] as const)('ROE %s → %s', (roe, level) => {
    expect(classifyFundamental('roe', { ...emptyFundamentals, roePct: roe }, 'OTHER', 'US').level).toBe(
      level,
    );
  });

  it('lower-is-better bounds are strict', () => {
    expect(lowerIsBetter(20, 20, 35).level).toBe('AVERAGE');
    expect(lowerIsBetter(35, 20, 35).level).toBe('AVERAGE');
    expect(lowerIsBetter(35.1, 20, 35).level).toBe('BAD');
    expect(higherIsBetter(null, 1, 0).level).toBe('NA');
  });

  it('negative P/E, PEG and margin are BAD', () => {
    expect(classifyFundamental('pe', { ...emptyFundamentals, pe: -4 }, 'OTHER', 'US').level).toBe('BAD');
    expect(classifyFundamental('peg', { ...emptyFundamentals, peg: -1 }, 'OTHER', 'US').level).toBe('BAD');
    expect(
      classifyFundamental('netMargin', { ...emptyFundamentals, netMarginPct: -2 }, 'OTHER', 'US').level,
    ).toBe('BAD');
  });

  it('relaxes D/E for utilities and real estate', () => {
    const f = { ...emptyFundamentals, de: 0.8 };
    expect(classifyFundamental('de', f, 'OTHER', 'US').level).toBe('AVERAGE');
    expect(classifyFundamental('de', f, 'UTILITIES_REAL_ESTATE', 'US').level).toBe('GOOD');
  });

  it('FCF with unknown trend is never GOOD', () => {
    expect(
      classifyFundamental('fcf', { ...emptyFundamentals, fcf: { ttm: 5, trend: null } }, 'OTHER', 'US').level,
    ).toBe('AVERAGE');
    expect(
      classifyFundamental('fcf', { ...emptyFundamentals, fcf: { ttm: -5, trend: null } }, 'OTHER', 'US')
        .level,
    ).toBe('BAD');
  });

  it('promoter holding applies to India only', () => {
    const f = { ...emptyFundamentals, promoterHoldingPct: 60, pledgePct: 0 };
    expect(classifyFundamental('promoterHolding', f, 'OTHER', 'IN').level).toBe('GOOD');
    expect(classifyFundamental('promoterHolding', f, 'OTHER', 'US').level).toBe('NA');
    expect(classifyFundamental('promoterHolding', { ...f, pledgePct: 15 }, 'OTHER', 'IN').level).toBe('BAD');
    expect(classifyFundamental('promoterHolding', { ...f, pledgePct: 5 }, 'OTHER', 'IN').level).toBe(
      'AVERAGE',
    );
  });

  it('returns NA for every fundamental without data', () => {
    expect(classifyFundamental('pe', null, 'OTHER', 'US').level).toBe('NA');
  });
});

describe('technical classification', () => {
  const rsi = (value: number, close: number): string =>
    classifyTechnical('rsi14', { ...emptyIndicators, rsi14: value, close, sma200: 100 }).level;

  it('classifies RSI with trend context', () => {
    expect(rsi(50, 110)).toBe('GOOD');
    expect(rsi(35, 110)).toBe('GOOD'); // pullback in uptrend
    expect(rsi(35, 90)).toBe('AVERAGE');
    expect(rsi(65, 110)).toBe('AVERAGE');
    expect(rsi(75, 110)).toBe('BAD');
    expect(rsi(25, 90)).toBe('BAD'); // oversold in downtrend
    expect(rsi(25, 110)).toBe('AVERAGE');
  });

  it('applies the ±2 % band to the 200-day trend', () => {
    const trend = (close: number): string =>
      classifyTechnical('trend200', { ...emptyIndicators, close, sma200: 100 }).level;
    expect(trend(102.5)).toBe('GOOD');
    expect(trend(101)).toBe('AVERAGE');
    expect(trend(97)).toBe('BAD');
  });

  it('classifies MACD by sign and signal', () => {
    const m = (macd: number, macdSignal: number): string =>
      classifyTechnical('macd', { ...emptyIndicators, macd, macdSignal }).level;
    expect(m(1, 0.5)).toBe('GOOD');
    expect(m(-1, -0.5)).toBe('BAD');
    expect(m(-0.5, -1)).toBe('AVERAGE');
  });

  it('classifies the 52-week range', () => {
    const r = (v: number): string =>
      classifyTechnical('range52w', { ...emptyIndicators, range52wPct: v }).level;
    expect(r(70)).toBe('GOOD');
    expect(r(95)).toBe('AVERAGE');
    expect(r(30)).toBe('AVERAGE');
    expect(r(10)).toBe('BAD');
  });
});

describe('analyseInstrument', () => {
  it('scores a healthy stock GOOD with pros and no cons', () => {
    const r = analyseInstrument(input());
    expect(r.technicalScore).toBeCloseTo(1, 9);
    expect(r.fundamentalScore).toBeCloseTo(1, 9);
    expect(r.healthScore).toBeCloseTo(100, 9);
    expect(r.healthLabel).toBe('GOOD');
    expect(r.pros.length).toBe(5);
    expect(r.cons).toEqual([]);
    expect(r.pros[0]?.weight).toBe(1.5);
    expect(r.pros.find((p) => p.key === 'roe')?.reason).toBe(
      'ROE 22% — strong return on shareholder capital (> 15%)',
    );
  });

  it('skips leverage checks for financials and boosts P/B and ROE', () => {
    const r = analyseInstrument(input({ sectorCategory: 'FINANCIALS' }));
    const keys = r.params.map((p) => p.key);
    expect(keys).not.toContain('de');
    expect(keys).not.toContain('currentRatio');
    expect(keys).not.toContain('roce');
    expect(keys).not.toContain('interestCoverage');
    expect(r.params.find((p) => p.key === 'pb')?.weight).toBe(2);
    expect(weightFor('roe', 'OTHER')).toBe(1.5);
  });

  it('returns a null label when fewer than 50 % of parameters have data', () => {
    const r = analyseInstrument(input({ fundamentals: null, indicators: { ...emptyIndicators, rsi14: 50 } }));
    expect(r.healthScore).toBeNull();
    expect(r.healthLabel).toBeNull();
  });

  it('uses the technical group alone when fundamentals are missing but data is sufficient', () => {
    const r = analyseInstrument(input({ fundamentals: { ...goodFundamentals, pe: 50, pb: 5, peg: 3 } }));
    expect(r.fundamentalScore).not.toBeNull();
    const techOnly = analyseInstrument(
      input({
        fundamentals: { ...emptyFundamentals, pe: 18, pb: 1, peg: 0.5, roePct: 20 },
        sectorCategory: 'OTHER',
      }),
    );
    // 8 technical + 4 of 12 fundamental available = 12/20 ≥ 50 %
    expect(techOnly.healthScore).not.toBeNull();
    expect(groupScore([])).toBeNull();
  });

  it('weights technical 40 % and fundamental 60 %', () => {
    const badTech: IndicatorSet = {
      ...healthyIndicators,
      close: 90,
      sma50: 95,
      rsi14: 75,
      macd: -1,
      macdSignal: -0.5,
      range52wPct: 10,
      drawdownPct: 30,
      volatilityPct: 50,
      volumeTrend: 0.5,
    };
    const r = analyseInstrument(input({ indicators: badTech }));
    expect(r.technicalScore).toBeCloseTo(-1, 9);
    expect(r.healthScore).toBeCloseTo(50 + 50 * (0.4 * -1 + 0.6 * 1), 9);
    expect(r.healthLabel).toBe('AVERAGE');
    expect(r.cons.length).toBe(5);
  });

  it('maps scores to labels at the boundaries', () => {
    expect(healthLabelFor(65)).toBe('GOOD');
    expect(healthLabelFor(64.99)).toBe('AVERAGE');
    expect(healthLabelFor(40)).toBe('AVERAGE');
    expect(healthLabelFor(39.99)).toBe('BAD');
  });

  it('gives NA params an "Insufficient data" reason', () => {
    const r = analyseInstrument(input({ fundamentals: { ...goodFundamentals, roce: null } }));
    expect(r.params.find((p) => p.key === 'roce')?.reason).toBe('Insufficient data');
  });
});

describe('assessMacro', () => {
  it('classifies VIX per market and index regime', () => {
    const m = assessMacro(macro);
    expect(m.indiaVix.level).toBe('CALM');
    expect(m.vix.level).toBe('ELEVATED');
    expect(m.nifty.regime).toBe('NEAR');
    expect(m.sp500.regime).toBe('BELOW');
    expect(
      assessMacro({ indiaVix: 21, vix: 26, nifty: null, sp500: { close: 1, sma200: null } }),
    ).toMatchObject({
      indiaVix: { level: 'FEAR' },
      vix: { level: 'FEAR' },
      nifty: { regime: null },
      sp500: { regime: null },
    });
  });
});

describe('sectorCategory', () => {
  it.each([
    ['Financial Services', null, 'FINANCIALS'],
    [null, 'Banks—Regional', 'FINANCIALS'],
    ['Utilities', null, 'UTILITIES_REAL_ESTATE'],
    ['Real Estate', null, 'UTILITIES_REAL_ESTATE'],
    ['Technology', null, 'TECH'],
    ['Consumer Defensive', null, 'FMCG'],
    ['Industrials', 'Electrical Equipment & Parts', 'OTHER'],
    [null, null, 'OTHER'],
  ] as const)('%s / %s → %s', (sector, industry, expected) => {
    expect(sectorCategory(sector, industry)).toBe(expected);
  });
});
