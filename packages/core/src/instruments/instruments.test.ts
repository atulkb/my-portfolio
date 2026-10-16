import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInstrumentMaster, checkBuildSanity, cleanUsName, type RawSources } from './build';
import {
  buildInstrumentIndex,
  closestSymbols,
  exchangesForSymbol,
  findListing,
  searchInstruments,
} from './search';
import { parseInstrumentTsv } from './tsv';

const NSE = `SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
RELIANCE,Reliance Industries Limited,EQ,29-NOV-1995,10,1,INE002A01018,10
INFY,Infosys Limited,EQ,08-FEB-1995,5,1,INE009A01021,5
TCS,Tata Consultancy Services Limited,EQ,25-AUG-2004,1,1,INE467B01029,1
GOLDBEES,Nippon India ETF Gold BeES,ZZ,01-JAN-2007,1,1,INF204KB17I5,1
`;

const BSE = `TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm
2026-10-15,2026-10-15,CM,BSE,STK,500325,INE002A01018,RELIANCE,A,,,,,RELIANCE INDUSTRIES LTD.
2026-10-15,2026-10-15,CM,BSE,STK,500209,INE009A01021,INFY,A,,,,,INFOSYS LTD.
2026-10-15,2026-10-15,CM,BSE,STK,543210,INE999Z01011,BSEONLY,X,,,,,BSE ONLY\tCOMPANY LTD
2026-10-15,2026-10-15,CM,BSE,MF,590001,INF000000001,SOMEFUND,A,,,,,SOME FUND
`;

const NASDAQ = `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
GOOGL|Alphabet Inc. - Class A Common Stock|Q|N|N|100|N|N
GOOG|Alphabet Inc. - Class C Capital Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
ZXZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N
File Creation Time: 1015202616:00|||||||
`;

const OTHER = `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|BRK.B|N|100|N|BRK.B
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
AHT$D|Ashford Hospitality Trust Inc 8.45% Series D|N|AHTpD|N|100|N|AHT-D
IEXA|Some IEX Stock|V|IEXA|N|100|N|IEXA
TSM|Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares|N|TSM|N|100|N|TSM
File Creation Time: 1015202616:00|||||||
`;

const sources: RawSources = {
  nseEquityCsv: NSE,
  bseBhavcopyCsv: BSE,
  nasdaqListed: NASDAQ,
  otherListed: OTHER,
};

describe('buildInstrumentMaster', () => {
  const { instruments, tsv, counts } = buildInstrumentMaster(sources);

  it('merges NSE and BSE by ISIN and keeps the NSE name', () => {
    const rel = instruments.find((i) => i.id === 'INE002A01018');
    expect(rel?.name).toBe('Reliance Industries Limited');
    expect(rel?.listings).toEqual([
      { exchange: 'NSE', symbol: 'RELIANCE', providerCode: null },
      { exchange: 'BSE', symbol: 'RELIANCE', providerCode: '500325' },
    ]);
    expect(counts.nseBseOverlap).toBe(2);
  });

  it('counts and filters each source', () => {
    expect(counts).toMatchObject({ nse: 3, bse: 3, us: 7, total: 11 });
    expect(counts.skipped).toEqual({
      nseSeries: 1,
      bseNonStock: 1,
      usTestIssue: 1,
      usOtherExchange: 1,
      invalidSymbol: 1,
    });
  });

  it('maps US exchanges, ETF flags and cleans names', () => {
    const byId = new Map(instruments.map((i) => [i.id, i]));
    expect(byId.get('NYSE:BRK.B')?.name).toBe('Berkshire Hathaway Inc.'); // no BRK.A here, so no class needed
    expect(byId.get('NYSE_ARCA:SPY')?.type).toBe('ETF');
    expect(byId.get('NASDAQ:AAPL')?.name).toBe('Apple Inc.');
    expect(byId.get('NASDAQ:GOOGL')?.name).toBe('Alphabet Inc. Class A'); // kept: GOOG shares the base name
    expect(byId.get('NASDAQ:GOOG')?.name).toBe('Alphabet Inc. Class C');
    expect(byId.get('NYSE:TSM')?.name).toBe('Taiwan Semiconductor Manufacturing Company Ltd.');
    expect(byId.get('BSE:BSEONLY')).toBeUndefined(); // has an ISIN → id is the ISIN
    expect(byId.get('INE999Z01011')?.name).toBe('BSE ONLY COMPANY LTD'); // tab stripped
  });

  it('is deterministic and sorted by id', () => {
    expect(buildInstrumentMaster(sources).tsv).toBe(tsv);
    const ids = instruments.map((i) => i.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('round-trips through TSV', () => {
    const parsed = parseInstrumentTsv(tsv);
    expect(parsed.skipped).toBe(0);
    expect(parsed.instruments).toEqual(instruments);
  });

  it('skips malformed TSV lines', () => {
    expect(parseInstrumentTsv('only\ttwo').skipped).toBe(1);
    expect(parseInstrumentTsv('X\tName\t\tEQUITY\t\t\t\tABC\tLSE\t').skipped).toBe(1);
    expect(parseInstrumentTsv('X\tName\t\tBOND\tABC\t\t\t\t\t').skipped).toBe(1);
  });
});

describe('cleanUsName', () => {
  it.each([
    ['Apple Inc. - Common Stock', 'Apple Inc.'],
    [
      'ATA Creativity Global - American Depositary Shares, each representing two common shares',
      'ATA Creativity Global',
    ],
    ['Alcoa Corporation Common Stock ', 'Alcoa Corporation'],
    ['SPDR S&P 500 ETF Trust', 'SPDR S&P 500 ETF Trust'],
  ])('%s → %s', (raw, clean) => {
    expect(cleanUsName(raw)).toBe(clean);
  });
});

describe('checkBuildSanity', () => {
  const healthy = { total: 18500, nse: 2600, bse: 5000, us: 13000 };

  it('passes a healthy build', () => {
    expect(checkBuildSanity(healthy, { nse: 2500, bse: 5100, us: 12800 }).ok).toBe(true);
    expect(checkBuildSanity(healthy, null).ok).toBe(true);
  });

  it('aborts on a −30 % market drop or a tiny total', () => {
    const drop = checkBuildSanity({ ...healthy, us: 9000 }, { nse: 2600, bse: 5000, us: 13000 });
    expect(drop.ok ? [] : drop.error).toHaveLength(1);
    expect(checkBuildSanity({ ...healthy, total: 9000 }, null).ok).toBe(false);
  });
});

describe('search', () => {
  const index = buildInstrumentIndex(buildInstrumentMaster(sources).instruments);

  it('ranks exact symbol, then prefix, then name matches', () => {
    expect(searchInstruments(index, 'relia')[0]?.instrument.name).toBe('Reliance Industries Limited');
    expect(searchInstruments(index, 'INFY.NS')[0]?.listing).toMatchObject({
      exchange: 'NSE',
      symbol: 'INFY',
    });
    expect(searchInstruments(index, 'apple')[0]?.listing.symbol).toBe('AAPL');
    expect(searchInstruments(index, 'GOOG').map((h) => h.listing.symbol)).toEqual(['GOOG', 'GOOGL']);
    expect(searchInstruments(index, 'tata consult')[0]?.match).toBe('NAME_WORD_PREFIX');
    expect(searchInstruments(index, 'onsultancy')[0]?.match).toBe('NAME_CONTAINS');
    expect(searchInstruments(index, '   ')).toEqual([]);
  });

  it('respects the market filter and limit', () => {
    expect(searchInstruments(index, 'reliance', { market: 'US' })).toEqual([]);
    expect(searchInstruments(index, 'reliance', { market: 'IN' })[0]?.listing.exchange).toBe('NSE');
    expect(searchInstruments(index, 'a', { limit: 2 })).toHaveLength(2);
  });

  it('looks up listings and suggests close symbols', () => {
    expect(findListing(index, 'BSE', 'RELIANCE')?.listing.providerCode).toBe('500325');
    expect(findListing(index, 'NSE', 'AAPL')).toBeNull();
    expect(exchangesForSymbol(index, 'AAPL')).toEqual(['NASDAQ']);
    expect(closestSymbols(index, 'RELIANC')[0]?.listing.symbol).toBe('RELIANCE');
    expect(closestSymbols(index, 'INFT', { market: 'IN' }).map((x) => x.listing.symbol)).toEqual([
      'INFY',
      'INFY',
    ]);
    expect(closestSymbols(index, 'XXXXXXXX')).toEqual([]);
  });
});

// Full build from the local development snapshot (git-ignored, so skipped in CI).
const SNAPSHOT = join(__dirname, '../../../../data/instruments/snapshot-2026-10-15');
const describeSnapshot = existsSync(SNAPSHOT) ? describe : describe.skip;

describeSnapshot('development snapshot', () => {
  const read = (f: string): string => readFileSync(join(SNAPSHOT, f), 'utf8');
  const result = buildInstrumentMaster({
    nseEquityCsv: read('nse_equity_list.csv'),
    bseBhavcopyCsv: read('bse_bhavcopy_2026-10-15.csv'),
    nasdaqListed: read('us_nasdaqlisted.txt'),
    otherListed: read('us_otherlisted.txt'),
  });

  it('builds ≈ 18.5k instruments and passes the sanity check', () => {
    expect(result.counts.total).toBeGreaterThan(17_000);
    expect(result.counts.total).toBeLessThan(20_000);
    expect(result.counts.nseBseOverlap).toBeGreaterThan(2_000);
    expect(checkBuildSanity(result.counts, null).ok).toBe(true);
  });

  it('searches the real list quickly and correctly', () => {
    const index = buildInstrumentIndex(result.instruments);
    const start = Date.now();
    const hits = searchInstruments(index, 'relia');
    expect(Date.now() - start).toBeLessThan(50);
    expect(hits[0]?.listing.symbol).toBe('RELIANCE');
    expect(searchInstruments(index, 'apple')[0]?.listing.symbol).toBe('AAPL');
  });
});
