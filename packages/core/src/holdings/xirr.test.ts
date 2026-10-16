import { benchmarkReturn, benchmarkReturnPct, excessReturnPp } from './benchmark';
import { xirr } from './xirr';
import type { DailyBar } from '../market/types';

describe('xirr', () => {
  it('matches the spreadsheet XIRR reference example', () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(0.373362535, 6);
  });

  it('matches a closed-form single-period return (365-day convention)', () => {
    const r = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1100 },
    ]);
    expect(r as number).toBeCloseTo(1.1 ** (365 / 366) - 1, 6);
  });

  it('handles losses', () => {
    const r = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2022-01-01', amount: 500 },
    ]);
    expect(r as number).toBeCloseTo(0.5 ** (365 / 731) - 1, 6);
  });

  it('is order-independent', () => {
    const flows = [
      { date: '2022-06-01', amount: 2500 },
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: -1000 },
    ];
    expect(xirr(flows) as number).toBeCloseTo(xirr([...flows].reverse()) as number, 9);
  });

  it.each([
    ['fewer than 2 flows', [{ date: '2020-01-01', amount: -1 }]],
    [
      'all negative',
      [
        { date: '2020-01-01', amount: -1 },
        { date: '2022-01-01', amount: -1 },
      ],
    ],
    [
      'span under 365 days',
      [
        { date: '2024-01-01', amount: -1000 },
        { date: '2024-12-30', amount: 1100 },
      ],
    ],
  ])('returns null for %s', (_label, flows) => {
    expect(xirr(flows)).toBeNull();
  });

  it('falls back to bisection when Newton diverges (extreme return)', () => {
    const r = xirr([
      { date: '2020-01-01', amount: -1 },
      { date: '2021-01-01', amount: 50 },
    ]);
    expect(r as number).toBeCloseTo(50 ** (365 / 366) - 1, 4);
  });
});

const bar = (date: string, adjClose: number): DailyBar => ({
  date,
  open: adjClose,
  high: adjClose,
  low: adjClose,
  close: adjClose,
  adjClose,
  volume: 0,
});

describe('benchmarkReturn', () => {
  const index = [
    bar('2023-01-02', 100),
    bar('2023-06-01', 110),
    bar('2024-01-02', 120),
    bar('2024-06-03', 132),
  ];

  it('invests the same amounts on the same dates', () => {
    const r = benchmarkReturn(
      [
        { date: '2023-01-02', amount: 1000 },
        { date: '2024-01-02', amount: 1200 },
      ],
      index,
      '2024-06-03',
    );
    // units = 10 + 10 = 20 → value 2640 on 2200 invested
    expect(r?.benchValue).toBeCloseTo(2640, 6);
    expect(r?.benchPnlPct).toBeCloseTo(20, 6);
    expect(r?.benchXirrPct).not.toBeNull();
  });

  it('uses the previous close for a buy on a holiday', () => {
    const r = benchmarkReturn([{ date: '2023-06-10', amount: 1100 }], index, '2024-06-03');
    expect(r?.benchValue).toBeCloseTo(1320, 6); // 10 units bought at 110
    expect(r?.benchXirrPct).toBeNull(); // < 365 days
  });

  it('returns null when history does not reach a buy', () => {
    expect(benchmarkReturn([{ date: '2022-12-01', amount: 100 }], index, '2024-06-03')).toBeNull();
  });

  it('returns null without buys', () => {
    expect(benchmarkReturn([], index, '2024-06-03')).toBeNull();
  });
});

describe('excessReturnPp', () => {
  const bench = { benchValue: 1, benchPnlPct: 10, benchXirrPct: 8 };

  it('compares annualised with annualised', () => {
    expect(excessReturnPp({ xirrPct: 12, pnlPct: 30 }, bench)).toBeCloseTo(4, 9);
  });

  it('compares absolute with absolute when not annualised', () => {
    expect(excessReturnPp({ xirrPct: null, pnlPct: 5 }, { ...bench, benchXirrPct: null })).toBeCloseTo(-5, 9);
  });

  it('is null without a benchmark or a return', () => {
    expect(excessReturnPp({ xirrPct: null, pnlPct: 5 }, null)).toBeNull();
    expect(excessReturnPp({ xirrPct: null, pnlPct: null }, bench)).toBeNull();
  });

  it('reports the annualised benchmark when available', () => {
    expect(benchmarkReturnPct(bench)).toBe(8);
    expect(benchmarkReturnPct({ ...bench, benchXirrPct: null })).toBe(10);
    expect(benchmarkReturnPct(null)).toBeNull();
  });
});
