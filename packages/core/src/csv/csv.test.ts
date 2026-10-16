import { buildInstrumentIndex } from '../instruments/search';
import type { Instrument } from '../models/instrument';
import type { BuyTransaction } from '../models/transaction';
import { findLikelyDuplicates } from './duplicates';
import { checkDate, closeHeaderMatch, normaliseExchange, parsePositiveNumber, resolveHeader } from './fields';
import { parseHoldingsCsv } from './parse';
import type { CsvDeps, CsvImportResult, CsvIssue } from './types';

const inst = (id: string, name: string, listings: Instrument['listings']): Instrument => ({
  id,
  name,
  isin: null,
  type: 'EQUITY',
  listings,
  industry: null,
});

const index = buildInstrumentIndex([
  inst('INE002A01018', 'Reliance Industries Limited', [
    { exchange: 'NSE', symbol: 'RELIANCE', providerCode: null },
    { exchange: 'BSE', symbol: 'RELIANCE', providerCode: '500325' },
  ]),
  inst('INE009A01021', 'Infosys Limited', [{ exchange: 'NSE', symbol: 'INFY', providerCode: null }]),
  inst('NASDAQ:AAPL', 'Apple Inc.', [{ exchange: 'NASDAQ', symbol: 'AAPL', providerCode: null }]),
]);

const deps = (p: Partial<CsvDeps> = {}): CsvDeps => ({
  fileName: 'holdings.csv',
  today: '2026-10-16',
  index,
  existing: [],
  knownPlatforms: ['Zerodha'],
  ...p,
});

const HEADER = 'symbol,name,exchange,quantity,buy_price,buy_date,platform';
const csv = (...rows: string[]): string => [HEADER, ...rows].join('\n');

function errorsOf(r: CsvImportResult): CsvIssue[] {
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('parseHoldingsCsv — success', () => {
  it('imports valid rows as CSV buys', () => {
    const r = parseHoldingsCsv(
      csv(
        'RELIANCE,Reliance Industries Ltd,NSE,10,2450.50,2024-03-15,Zerodha',
        'aapl,Apple Inc,nasdaq gs,0.5,"$1,234.00",2023-01-02,IBKR',
      ),
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transactions).toEqual([
      {
        type: 'BUY',
        symbol: 'RELIANCE',
        exchange: 'NSE',
        name: 'Reliance Industries Ltd',
        platform: 'Zerodha',
        quantity: 10,
        price: 2450.5,
        tradeDate: '2024-03-15',
        source: 'CSV',
      },
      expect.objectContaining({ symbol: 'AAPL', exchange: 'NASDAQ', quantity: 0.5, price: 1234 }),
    ]);
    expect(r.newPlatforms).toEqual(['IBKR']);
    expect(r.warnings.map((w) => w.code)).toEqual(['CSV_NEW_PLATFORM']);
  });

  it('accepts aliases, a BOM, semicolons and an optional sector column', () => {
    const text =
      '﻿Ticker;Company;Exch;Qty;Avg_Price;Trade Date;Broker;Industry\nINFY;Infosys;NSE;5;1500;2024-01-10;zerodha;IT Services';
    const r = parseHoldingsCsv(text, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transactions[0]?.symbol).toBe('INFY');
    expect(r.sectorOverrides).toEqual({ 'NSE:INFY': 'IT Services' });
    expect(r.newPlatforms).toEqual([]); // case-insensitive match with Zerodha
  });

  it('warns (never blocks) on a name mismatch and unknown columns', () => {
    const text = `${HEADER},notes\nINFY,Infosys Technologies,NSE,5,1500,2024-01-10,Zerodha,long term`;
    const r = parseHoldingsCsv(text, deps());
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['CSV_NAME_MISMATCH', 'CSV_UNKNOWN_COLUMN']);
    expect(r.warnings.find((w) => w.code === 'CSV_NAME_MISMATCH')?.message).toBe(
      'Master list name is `Infosys Limited`.',
    );
  });

  it('flags likely duplicates without rejecting them', () => {
    const existing: BuyTransaction = {
      id: 'tx1',
      schemaVersion: 1,
      type: 'BUY',
      symbol: 'INFY',
      exchange: 'NSE',
      name: 'Infosys',
      platform: 'ZERODHA',
      quantity: 5,
      price: 1400,
      tradeDate: '2024-01-10',
      source: 'MANUAL',
      importBatchId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const r = parseHoldingsCsv(
      csv('INFY,Infosys,NSE,5,1500,2024-01-10,Zerodha', 'INFY,Infosys,NSE,5,1500,2024-01-10,Zerodha'),
      deps({ existing: [existing] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transactions).toHaveLength(2);
    expect(r.likelyDuplicates).toEqual([expect.objectContaining({ incoming: [0, 1], existingIds: ['tx1'] })]);
  });
});

describe('parseHoldingsCsv — errors', () => {
  it.each([
    [
      'CSV_SYMBOL_SUFFIX',
      'INFY.NS,Infosys,NSE,5,1500,2024-01-10,Zerodha',
      'Use symbol `INFY`, exchange `NSE`',
    ],
    ['CSV_UNKNOWN_SYMBOL', 'AAPL,Apple,NSE,5,150,2024-01-10,Zerodha', '`AAPL` is listed on `NASDAQ`'],
    ['CSV_UNKNOWN_SYMBOL', 'RELIANC,Reliance,NSE,5,150,2024-01-10,Zerodha', 'Did you mean `RELIANCE`'],
    [
      'CSV_UNKNOWN_SYMBOL',
      'ZZZZZZZZZ,Reliance Industries,NSE,5,150,2024-01-10,Zerodha',
      'Did you mean `RELIANCE`',
    ],
    ['CSV_BAD_EXCHANGE', 'INFY,Infosys,LSE,5,1500,2024-01-10,Zerodha', 'Use one of NSE'],
    ['CSV_BAD_DATE', 'INFY,Infosys,NSE,5,1500,yesterday,Zerodha', 'Use YYYY-MM-DD'],
    ['CSV_AMBIGUOUS_DATE', 'INFY,Infosys,NSE,5,1500,05/03/2024,Zerodha', '`2024-03-05` or `2024-05-03`'],
    ['CSV_DATE_FORMAT', 'INFY,Infosys,NSE,5,1500,15/03/2024,Zerodha', 'Use `2024-03-15`'],
    ['CSV_DATE_FORMAT', 'INFY,Infosys,NSE,5,1500,15-Mar-2024,Zerodha', 'Use `2024-03-15`'],
    ['CSV_FUTURE_DATE', 'INFY,Infosys,NSE,5,1500,2026-10-17,Zerodha', null],
    ['CSV_DATE_TOO_OLD', 'INFY,Infosys,NSE,5,1500,1989-12-31,Zerodha', null],
    ['CSV_BAD_NUMBER', 'INFY,Infosys,NSE,-5,1500,2024-01-10,Zerodha', 'Quantity must be a positive number'],
    ['CSV_BAD_NUMBER', 'INFY,Infosys,NSE,5,1x50,2024-01-10,Zerodha', 'Buy price must be a positive number'],
    ['CSV_FRACTIONAL_IN', 'INFY,Infosys,NSE,1.5,1500,2024-01-10,Zerodha', 'whole number'],
    ['CSV_MISSING_VALUE', 'INFY,Infosys,NSE,5,,2024-01-10,Zerodha', 'Fill in `buy_price` on line 2'],
    ['CSV_TOO_LONG', `INFY,Infosys,NSE,5,1500,2024-01-10,${'x'.repeat(41)}`, 'Shorten'],
  ])('%s: %s', (code, row, suggestion) => {
    const errors = errorsOf(parseHoldingsCsv(csv(row), deps()));
    const e = errors.find((x) => x.code === code);
    expect(e).toBeDefined();
    expect(e?.row).toBe(2);
    expect(e?.fileName).toBe('holdings.csv');
    if (suggestion) expect(e?.suggestion).toContain(suggestion);
  });

  it('reports a missing column with a rename fix', () => {
    const text =
      'symbol,name,exchange,quantty,buy_price,buy_date,platform\nINFY,Infosys,NSE,5,1500,2024-01-10,Zerodha';
    const e = errorsOf(parseHoldingsCsv(text, deps()))[0];
    expect(e).toMatchObject({ code: 'CSV_MISSING_COLUMN', row: 1, column: 'quantity' });
    expect(e?.suggestion).toBe('Rename column `quantty` → `quantity`');
  });

  it('reports every issue at once, sorted by line, and imports nothing', () => {
    const r = parseHoldingsCsv(
      csv(
        'INFY,Infosys,NSE,5,1500,2024-01-10,Zerodha',
        'BAD.NS,x,NSE,5,1,2024-01-10,Z',
        'INFY,Infosys,NSE,0,1500,2024-01-10,Zerodha',
      ),
      deps(),
    );
    const errors = errorsOf(r);
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
    expect(errors[0]?.rowPreview).toBe('BAD.NS · NSE · 2024-01-10');
  });

  it('uses real file line numbers with blank lines and multi-line quoted fields', () => {
    const text = `${HEADER}\n\nINFY,"Infosys\nLimited",NSE,5,1500,2024-01-10,Zerodha\nINFY,Infosys,NSE,0,1500,2024-01-10,Zerodha`;
    const errors = errorsOf(parseHoldingsCsv(text, deps()));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.row).toBe(5);
  });

  it.each([
    ['empty file', ''],
    ['header only', HEADER],
  ])('rejects %s', (_label, text) => {
    expect(errorsOf(parseHoldingsCsv(text, deps()))[0]?.code).toBe('CSV_EMPTY');
  });

  it('rejects files over the row and size limits', () => {
    const many = csv(...Array.from({ length: 2001 }, () => 'INFY,Infosys,NSE,5,1500,2024-01-10,Zerodha'));
    expect(errorsOf(parseHoldingsCsv(many, deps()))[0]?.code).toBe('CSV_TOO_LARGE');
    expect(errorsOf(parseHoldingsCsv('x'.repeat(1_048_577), deps()))[0]?.code).toBe('CSV_TOO_LARGE');
  });
});

describe('field helpers', () => {
  it('resolves headers and close matches', () => {
    expect(resolveHeader(' Buy Date ')).toBe('buy_date');
    expect(resolveHeader('Avg Price')).toBe('buy_price');
    expect(resolveHeader('notes')).toBeNull();
    expect(closeHeaderMatch('symbl')).toBe('symbol');
    expect(closeHeaderMatch('xyzzy')).toBeNull();
  });

  it('normalises exchanges', () => {
    expect(normaliseExchange('NYSEARCA')).toBe('NYSE_ARCA');
    expect(normaliseExchange('nyse arca')).toBe('NYSE_ARCA');
    expect(normaliseExchange('AMEX')).toBe('NYSE_AMERICAN');
    expect(normaliseExchange('LSE')).toBeNull();
  });

  it.each([
    ['1,680.00', 1680],
    ['₹ 2,450.5', 2450.5],
    ['$12', 12],
    ['.5', 0.5],
    ['0', null],
    ['-5', null],
    ['1.2.3', null],
    ['12abc', null],
  ])('parsePositiveNumber(%j) → %j', (raw, expected) => {
    expect(parsePositiveNumber(raw)).toBe(expected);
  });

  it('handles more date shapes', () => {
    expect(checkDate('2024/03/15', '2026-10-16')).toMatchObject({
      code: 'CSV_DATE_FORMAT',
      suggestion: 'Use `2024-03-15`',
    });
    expect(checkDate('03/15/2024', '2026-10-16')).toMatchObject({
      code: 'CSV_DATE_FORMAT',
      suggestion: 'Use `2024-03-15`',
    });
    expect(checkDate('05/05/2024', '2026-10-16')).toMatchObject({ code: 'CSV_DATE_FORMAT' });
    expect(checkDate('Mar 15, 2024', '2026-10-16')).toMatchObject({ suggestion: 'Use `2024-03-15`' });
    expect(checkDate('31/02/2024', '2026-10-16').ok).toBe(false);
    expect(checkDate('2024-02-30', '2026-10-16')).toMatchObject({ code: 'CSV_BAD_DATE' });
    expect(checkDate('15-Foo-2024', '2026-10-16')).toMatchObject({ code: 'CSV_BAD_DATE' });
    expect(checkDate('15/03/24', '2026-10-16')).toMatchObject({ code: 'CSV_BAD_DATE' });
  });
});

describe('findLikelyDuplicates', () => {
  it('returns nothing for distinct buys', () => {
    const a = {
      symbol: 'INFY',
      exchange: 'NSE' as const,
      platform: 'Zerodha',
      tradeDate: '2024-01-10',
      quantity: 5,
    };
    expect(findLikelyDuplicates([a, { ...a, quantity: 6 }], [])).toEqual([]);
  });
});
