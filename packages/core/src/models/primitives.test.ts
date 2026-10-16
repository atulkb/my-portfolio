import {
  EXCHANGE_META,
  EXCHANGES,
  InstrumentKeySchema,
  IsoDateSchema,
  isValidCalendarDate,
  normalisePlatform,
  parseInstrumentKey,
  PlatformSchema,
  SymbolSchema,
  toInstrumentKey,
} from './primitives';

describe('SymbolSchema', () => {
  it.each(['RELIANCE', 'BRK.B', 'M&M', 'BAJAJ-AUTO', 'A'])('accepts %s', (s) => {
    expect(SymbolSchema.parse(s)).toBe(s);
  });

  it('trims and uppercases', () => {
    expect(SymbolSchema.parse('  infy ')).toBe('INFY');
  });

  it.each(['', '.NS', 'TOO_LONG_SYMBOL_123456', 'AB CD', 'RELIANCE.NS!'])('rejects %j', (s) => {
    expect(SymbolSchema.safeParse(s).success).toBe(false);
  });
});

describe('IsoDateSchema', () => {
  it.each(['2024-03-15', '2024-02-29', '1990-01-01'])('accepts %s', (d) => {
    expect(IsoDateSchema.parse(d)).toBe(d);
  });

  it.each(['2023-02-29', '2024-13-01', '2024-04-31', '15/03/2024', '2024-3-5', ''])('rejects %j', (d) => {
    expect(IsoDateSchema.safeParse(d).success).toBe(false);
  });

  it('isValidCalendarDate rejects non-ISO strings', () => {
    expect(isValidCalendarDate('2024-03-15T00:00')).toBe(false);
  });
});

describe('instrument keys', () => {
  it('round-trips through toInstrumentKey / parseInstrumentKey', () => {
    const key = toInstrumentKey('NYSE_ARCA', 'SPY');
    expect(key).toBe('NYSE_ARCA:SPY');
    expect(parseInstrumentKey(key)).toEqual({ exchange: 'NYSE_ARCA', symbol: 'SPY' });
  });

  it.each(['NSE:RELIANCE', 'NASDAQ:AAPL', 'BSE:M&M'])('accepts %s', (k) => {
    expect(InstrumentKeySchema.safeParse(k).success).toBe(true);
  });

  it.each(['LSE:VOD', 'NSE:', 'nse:reliance', 'NSE RELIANCE', 42])('rejects %j', (k) => {
    expect(InstrumentKeySchema.safeParse(k).success).toBe(false);
    if (typeof k === 'string') expect(parseInstrumentKey(k)).toBeNull();
  });
});

describe('EXCHANGE_META', () => {
  it('maps every exchange to a market and its currency', () => {
    for (const ex of EXCHANGES) {
      const { market, currency } = EXCHANGE_META[ex];
      expect(currency).toBe(market === 'IN' ? 'INR' : 'USD');
    }
    expect(EXCHANGE_META.BSE.market).toBe('IN');
    expect(EXCHANGE_META.CBOE.market).toBe('US');
  });
});

describe('platforms', () => {
  it('trims and bounds length', () => {
    expect(PlatformSchema.parse('  Zerodha ')).toBe('Zerodha');
    expect(PlatformSchema.safeParse('   ').success).toBe(false);
    expect(PlatformSchema.safeParse('x'.repeat(41)).success).toBe(false);
  });

  it('normalises case-insensitively', () => {
    expect(normalisePlatform(' ICICI Direct ')).toBe(normalisePlatform('icici direct'));
  });
});
