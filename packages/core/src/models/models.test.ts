import { INSTRUMENT_TSV_COLUMNS, InstrumentMasterMetaSchema, InstrumentSchema } from './instrument';
import { MAX_COMPILED_LOGIC_LENGTH, NewRuleSchema, RuleResultSchema, RuleSchema, ruleResultId } from './rule';
import { applyBuyPatch, BuyTransactionSchema, newBuyTransactionSchema } from './transaction';
import { UserProfileSchema } from './user';
import { NewWatchlistItemSchema, WatchlistItemSchema, WatchlistSchema } from './watchlist';

const TODAY = '2026-10-16';
const ts = { createdAt: 1, updatedAt: 2 };

const buyDoc = {
  schemaVersion: 1,
  type: 'BUY',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  name: 'Reliance Industries Ltd',
  platform: 'Zerodha',
  quantity: 10,
  price: 2450.5,
  tradeDate: '2024-03-15',
  source: 'CSV',
  importBatchId: 'batch-1',
  ...ts,
} as const;

const { schemaVersion: _v, importBatchId: _b, createdAt: _c, updatedAt: _u, ...newBuy } = buyDoc;

describe('BuyTransactionSchema', () => {
  it('accepts a valid stored buy', () => {
    expect(BuyTransactionSchema.parse(buyDoc)).toEqual(buyDoc);
  });

  it('normalises a lowercase symbol', () => {
    expect(BuyTransactionSchema.parse({ ...buyDoc, symbol: 'reliance' }).symbol).toBe('RELIANCE');
  });

  it.each([
    ['zero price', { price: 0 }],
    ['negative price', { price: -1 }],
    ['zero quantity', { quantity: 0 }],
    ['fractional NSE quantity', { quantity: 1.5 }],
    ['fractional BSE quantity', { exchange: 'BSE', quantity: 0.5 }],
    ['1989 date', { tradeDate: '1989-12-31' }],
    ['invalid calendar date', { tradeDate: '2024-02-30' }],
    ['unknown exchange', { exchange: 'LSE' }],
    ['SELL type', { type: 'SELL' }],
    ['empty name', { name: '' }],
    ['name too long', { name: 'x'.repeat(121) }],
    ['platform too long', { platform: 'x'.repeat(41) }],
    ['unknown source', { source: 'API' }],
    ['schemaVersion 2', { schemaVersion: 2 }],
  ])('rejects %s', (_label, patch) => {
    expect(BuyTransactionSchema.safeParse({ ...buyDoc, ...patch }).success).toBe(false);
  });

  it('allows fractional quantities for US exchanges', () => {
    const us = { ...buyDoc, symbol: 'AAPL', exchange: 'NASDAQ', quantity: 0.25 };
    expect(BuyTransactionSchema.safeParse(us).success).toBe(true);
  });

  it('does not reject stored docs dated after the device clock (no today check on read)', () => {
    expect(BuyTransactionSchema.safeParse({ ...buyDoc, tradeDate: '2099-01-01' }).success).toBe(true);
  });
});

describe('newBuyTransactionSchema', () => {
  const schema = newBuyTransactionSchema(TODAY);

  it('accepts today and rejects the future', () => {
    expect(schema.safeParse({ ...newBuy, tradeDate: TODAY }).success).toBe(true);
    expect(schema.safeParse({ ...newBuy, tradeDate: '2026-10-17' }).success).toBe(false);
  });

  it('reports the failing field path', () => {
    const r = schema.safeParse({ ...newBuy, quantity: 2.5 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['quantity']);
  });
});

describe('applyBuyPatch', () => {
  it('validates the merged result', () => {
    expect(applyBuyPatch(buyDoc, { quantity: 12, platform: 'Groww' }, TODAY).success).toBe(true);
    expect(applyBuyPatch(buyDoc, { quantity: 1.2 }, TODAY).success).toBe(false);
    expect(applyBuyPatch(buyDoc, { tradeDate: '2030-01-01' }, TODAY).success).toBe(false);
  });
});

describe('UserProfileSchema', () => {
  const profile = {
    schemaVersion: 1,
    displayName: 'Test User',
    email: 'test@example.com',
    authProvider: 'google',
    ...ts,
  };

  it('fills defaults for settings, platforms and overrides', () => {
    expect(UserProfileSchema.parse(profile)).toMatchObject({
      settings: { summaryCurrency: 'INR', defaultSort: 'VALUE_DESC', aiSuggestions: true },
      platforms: [],
      sectorOverrides: {},
    });
  });

  it('keeps partial settings and fills the rest', () => {
    const parsed = UserProfileSchema.parse({ ...profile, settings: { summaryCurrency: 'USD' } });
    expect(parsed.settings).toEqual({
      summaryCurrency: 'USD',
      defaultSort: 'VALUE_DESC',
      aiSuggestions: true,
    });
  });

  it.each([
    ['bad email', { email: 'nope' }],
    ['empty name', { displayName: ' ' }],
    ['31 platforms', { platforms: Array.from({ length: 31 }, (_, i) => `P${i}`) }],
    ['bad override key', { sectorOverrides: { RELIANCE: 'Energy' } }],
    ['unknown provider', { authProvider: 'apple' }],
  ])('rejects %s', (_label, patch) => {
    expect(UserProfileSchema.safeParse({ ...profile, ...patch }).success).toBe(false);
  });

  it('accepts sector overrides keyed by instrument key', () => {
    const parsed = UserProfileSchema.parse({ ...profile, sectorOverrides: { 'NSE:RELIANCE': 'Energy' } });
    expect(parsed.sectorOverrides).toEqual({ 'NSE:RELIANCE': 'Energy' });
  });
});

describe('watchlist schemas', () => {
  it('validates names', () => {
    const wl = { schemaVersion: 1, name: 'My Watchlist', sortOrder: 0, ...ts };
    expect(WatchlistSchema.safeParse(wl).success).toBe(true);
    expect(WatchlistSchema.safeParse({ ...wl, name: '' }).success).toBe(false);
    expect(WatchlistSchema.safeParse({ ...wl, name: 'x'.repeat(41) }).success).toBe(false);
  });

  it('validates items', () => {
    const item = {
      symbol: 'NVDA',
      exchange: 'NASDAQ',
      targetEntryPrice: 128,
      targetExitPrice: null,
      notes: null,
    };
    expect(NewWatchlistItemSchema.safeParse(item).success).toBe(true);
    expect(
      WatchlistItemSchema.safeParse({ schemaVersion: 1, ...item, addedAt: 1, updatedAt: 2 }).success,
    ).toBe(true);
    expect(NewWatchlistItemSchema.safeParse({ ...item, targetEntryPrice: 0 }).success).toBe(false);
    expect(NewWatchlistItemSchema.safeParse({ ...item, notes: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('rule schemas', () => {
  const rule = {
    name: 'Oversold',
    naturalPrompt: 'RSI below 30',
    compiledLogicJson: '{"<":[{"var":"rsi14"},30]}',
    readBack: 'RSI (14) is below 30',
    variables: ['rsi14'],
    appliesToPortfolio: true,
    appliesToWatchlists: false,
    enabled: true,
    compiledWith: { model: 'gemini-3.5-flash', promptVersion: 'rule-compile@1' },
  };

  it('accepts a valid rule', () => {
    expect(NewRuleSchema.safeParse(rule).success).toBe(true);
    expect(RuleSchema.safeParse({ schemaVersion: 1, ...rule, ...ts }).success).toBe(true);
  });

  it.each([
    ['both scopes false', { appliesToPortfolio: false, appliesToWatchlists: false }],
    ['unknown variable', { variables: ['peRatio'] }],
    ['no variables', { variables: [] }],
    ['logic too long', { compiledLogicJson: 'x'.repeat(MAX_COMPILED_LOGIC_LENGTH + 1) }],
    ['prompt too short', { naturalPrompt: 'hi' }],
  ])('rejects %s', (_label, patch) => {
    expect(NewRuleSchema.safeParse({ ...rule, ...patch }).success).toBe(false);
  });

  it('validates rule results and their IDs', () => {
    const result = {
      schemaVersion: 1,
      ruleId: 'r1',
      sessionDate: '2026-10-15',
      matches: [{ instrumentKey: 'NSE:INFY', scope: 'PORTFOLIO' }],
      evaluatedAt: 1,
    };
    expect(RuleResultSchema.safeParse(result).success).toBe(true);
    expect(
      RuleResultSchema.safeParse({ ...result, matches: [{ instrumentKey: 'INFY', scope: 'PORTFOLIO' }] })
        .success,
    ).toBe(false);
    expect(ruleResultId('2026-10-15', 'r1')).toBe('2026-10-15_r1');
  });
});

describe('instrument schemas', () => {
  it('validates instruments and ISINs', () => {
    const inst = {
      id: 'INE002A01018',
      name: 'Reliance Industries Ltd',
      isin: 'INE002A01018',
      type: 'EQUITY',
      listings: [
        { exchange: 'NSE', symbol: 'RELIANCE', providerCode: null },
        { exchange: 'BSE', symbol: 'RELIANCE', providerCode: '500325' },
      ],
      industry: null,
    };
    expect(InstrumentSchema.safeParse(inst).success).toBe(true);
    expect(InstrumentSchema.safeParse({ ...inst, isin: 'INE002A0101' }).success).toBe(false);
    expect(InstrumentSchema.safeParse({ ...inst, listings: [] }).success).toBe(false);
  });

  it('validates meta columns and hash', () => {
    const meta = {
      schemaVersion: 1,
      version: '2026-10-15.1',
      generatedAt: 1,
      sourceDates: { nse: '2026-10-15', bse: '2026-10-15', us: '2026-10-15' },
      counts: { total: 18512, nse: 2605, bse: 5048, us: 13306 },
      chunkIds: ['2026-10-15.1-0', '2026-10-15.1-1'],
      sha256: 'a'.repeat(64),
      columns: INSTRUMENT_TSV_COLUMNS,
    };
    expect(InstrumentMasterMetaSchema.safeParse(meta).success).toBe(true);
    expect(InstrumentMasterMetaSchema.safeParse({ ...meta, sha256: 'xyz' }).success).toBe(false);
    expect(InstrumentMasterMetaSchema.safeParse({ ...meta, columns: 'id\tname' }).success).toBe(false);
  });
});
