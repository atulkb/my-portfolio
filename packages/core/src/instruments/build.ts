import Papa from 'papaparse';
import type { Instrument, InstrumentType, Listing } from '../models/instrument';
import { SymbolSchema, type Exchange } from '../models/primitives';
import { err, ok, type Result } from '../util/result';
import { collapseWhitespace } from '../util/text';
import { instrumentsToTsv, sanitiseField } from './tsv';

/** The four raw exchange files (formats in data/instruments/README.md). */
export type RawSources = {
  readonly nseEquityCsv: string;
  readonly bseBhavcopyCsv: string;
  readonly nasdaqListed: string;
  readonly otherListed: string;
};

/** Row counts of a build, compared with the previous run by the sanity check. */
export type BuildCounts = {
  readonly total: number;
  readonly nse: number;
  readonly bse: number;
  readonly us: number;
  /** Companies listed on both NSE and BSE (merged by ISIN). */
  readonly nseBseOverlap: number;
  readonly skipped: Readonly<
    Record<'nseSeries' | 'bseNonStock' | 'usTestIssue' | 'usOtherExchange' | 'invalidSymbol', number>
  >;
};

/** NSE series kept (equity, trade-for-trade, SME). */
export const NSE_SERIES = ['EQ', 'BE', 'BZ', 'SM', 'ST'] as const;
/** Nasdaq Trader `otherlisted.txt` exchange codes kept. IEX (V) and others are skipped. */
const OTHER_EXCHANGES: Readonly<Record<string, Exchange>> = {
  N: 'NYSE',
  A: 'NYSE_AMERICAN',
  P: 'NYSE_ARCA',
  Z: 'CBOE',
};

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

type Row = Record<string, string>;

function parseDelimited(text: string, delimiter: ',' | '|'): Row[] {
  const parsed = Papa.parse<Row>(text.replace(/^﻿/, ''), {
    header: true,
    delimiter,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });
  return parsed.data;
}

function validSymbol(raw: string | undefined): string | null {
  const r = SymbolSchema.safeParse(raw ?? '');
  return r.success ? r.data : null;
}

const SHARE_BOILERPLATE =
  /\s*(?:-\s*)?(?:American Depositary Shares.*|Common Stock|Common Shares|Ordinary Shares|Capital Stock|Shares of Beneficial Interest|New York Registry Shares)\s*$/i;

/** US security names: drop trailing share-class boilerplate ("Common Stock", "- American Depositary Shares…"). */
export function cleanUsName(raw: string): string {
  let s = collapseWhitespace(raw);
  for (let i = 0; i < 2; i++) s = s.replace(SHARE_BOILERPLATE, '').replace(/[\s,-]+$/, '');
  // "Alphabet Inc. - Class A" → "Alphabet Inc. Class A" (hyphenated words like Coca-Cola untouched).
  s = s.replace(/\s+-\s+/g, ' ');
  return s || collapseWhitespace(raw);
}

const CLASS_SUFFIX = /\s+Class [A-Z]$/;

/**
 * Builds the merged instrument master (LLD §2.10): NSE + BSE merged by ISIN (name preference
 * NSE → BSE), US listings from both Nasdaq Trader files. Output is sorted by `id` so unchanged
 * sources give an identical TSV (stable sha256).
 */
export function buildInstrumentMaster(sources: RawSources): {
  instruments: Instrument[];
  tsv: string;
  counts: BuildCounts;
} {
  const skipped = { nseSeries: 0, bseNonStock: 0, usTestIssue: 0, usOtherExchange: 0, invalidSymbol: 0 };
  const byId = new Map<string, Instrument & { listings: Listing[] }>();
  const byIsin = new Map<string, string>();
  let nse = 0;
  let bse = 0;
  let overlap = 0;

  for (const row of parseDelimited(sources.nseEquityCsv, ',')) {
    if (!(NSE_SERIES as readonly string[]).includes(row['SERIES'] ?? '')) {
      skipped.nseSeries += 1;
      continue;
    }
    const symbol = validSymbol(row['SYMBOL']);
    if (!symbol) {
      skipped.invalidSymbol += 1;
      continue;
    }
    const isin = ISIN_RE.test(row['ISIN NUMBER'] ?? '') ? (row['ISIN NUMBER'] as string) : null;
    const id = isin ?? `NSE:${symbol}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name: sanitiseField(collapseWhitespace(row['NAME OF COMPANY'] ?? symbol)),
      isin,
      type: 'EQUITY',
      listings: [{ exchange: 'NSE', symbol, providerCode: null }],
      industry: null,
    });
    if (isin) byIsin.set(isin, id);
    nse += 1;
  }

  for (const row of parseDelimited(sources.bseBhavcopyCsv, ',')) {
    if (row['FinInstrmTp'] !== 'STK') {
      skipped.bseNonStock += 1;
      continue;
    }
    const symbol = validSymbol(row['TckrSymb']);
    if (!symbol) {
      skipped.invalidSymbol += 1;
      continue;
    }
    const isin = ISIN_RE.test(row['ISIN'] ?? '') ? (row['ISIN'] as string) : null;
    const listing: Listing = { exchange: 'BSE', symbol, providerCode: row['FinInstrmId'] || null };
    const existingId = isin ? byIsin.get(isin) : undefined;
    const existing = existingId ? byId.get(existingId) : undefined;
    if (existing) {
      if (existing.listings.some((l) => l.exchange === 'BSE')) continue;
      existing.listings.push(listing);
      overlap += 1;
      bse += 1;
      continue;
    }
    const id = isin ?? `BSE:${symbol}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name: sanitiseField(collapseWhitespace(row['FinInstrmNm'] ?? symbol)),
      isin,
      type: 'EQUITY',
      listings: [listing],
      industry: null,
    });
    if (isin) byIsin.set(isin, id);
    bse += 1;
  }

  type UsRow = { symbol: string; exchange: Exchange; rawName: string; type: InstrumentType };
  const usRows: UsRow[] = [];
  const isData = (row: Row, symbolCol: string): boolean =>
    !(row[symbolCol] ?? '').startsWith('File Creation Time');

  for (const row of parseDelimited(sources.nasdaqListed, '|')) {
    if (!isData(row, 'Symbol')) continue;
    if (row['Test Issue'] !== 'N') {
      skipped.usTestIssue += 1;
      continue;
    }
    const symbol = validSymbol(row['Symbol']);
    if (!symbol) {
      skipped.invalidSymbol += 1;
      continue;
    }
    usRows.push({
      symbol,
      exchange: 'NASDAQ',
      rawName: row['Security Name'] ?? symbol,
      type: row['ETF'] === 'Y' ? 'ETF' : 'EQUITY',
    });
  }
  for (const row of parseDelimited(sources.otherListed, '|')) {
    if (!isData(row, 'ACT Symbol')) continue;
    if (row['Test Issue'] !== 'N') {
      skipped.usTestIssue += 1;
      continue;
    }
    const exchange = OTHER_EXCHANGES[row['Exchange'] ?? ''];
    if (!exchange) {
      skipped.usOtherExchange += 1;
      continue;
    }
    const symbol = validSymbol(row['ACT Symbol']);
    if (!symbol) {
      skipped.invalidSymbol += 1;
      continue;
    }
    usRows.push({
      symbol,
      exchange,
      rawName: row['Security Name'] ?? symbol,
      type: row['ETF'] === 'Y' ? 'ETF' : 'EQUITY',
    });
  }

  // Keep "Class A" only where two US listings would otherwise share a name.
  const cleaned = usRows.map((r) => ({ ...r, name: cleanUsName(r.rawName) }));
  const baseCount = new Map<string, number>();
  for (const r of cleaned) {
    const base = r.name.replace(CLASS_SUFFIX, '');
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
  }
  let us = 0;
  for (const r of cleaned) {
    const base = r.name.replace(CLASS_SUFFIX, '');
    const name = (baseCount.get(base) ?? 0) > 1 ? r.name : base;
    const id = `${r.exchange}:${r.symbol}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name: sanitiseField(name),
      isin: null,
      type: r.type,
      listings: [{ exchange: r.exchange, symbol: r.symbol, providerCode: null }],
      industry: null,
    });
    us += 1;
  }

  const instruments = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    instruments,
    tsv: instrumentsToTsv(instruments),
    counts: { total: instruments.length, nse, bse, us, nseBseOverlap: overlap, skipped },
  };
}

/** Minimum instruments in a healthy build. */
export const MIN_TOTAL_INSTRUMENTS = 10_000;
/** Allowed change per market versus the previous build. */
export const MAX_MARKET_CHANGE = 0.2;

/**
 * Sanity check before upload (HLD §15): total ≥ 10,000 and each market within ±20 % of the
 * previous build. A failure means the sync aborts without writing.
 */
export function checkBuildSanity(
  counts: Pick<BuildCounts, 'total' | 'nse' | 'bse' | 'us'>,
  previous: Pick<BuildCounts, 'nse' | 'bse' | 'us'> | null,
): Result<true, string[]> {
  const problems: string[] = [];
  if (counts.total < MIN_TOTAL_INSTRUMENTS)
    problems.push(`Only ${counts.total} instruments (minimum ${MIN_TOTAL_INSTRUMENTS}).`);
  if (previous) {
    for (const market of ['nse', 'bse', 'us'] as const) {
      const before = previous[market];
      const after = counts[market];
      if (before > 0 && Math.abs(after - before) / before > MAX_MARKET_CHANGE) {
        problems.push(
          `${market.toUpperCase()} changed from ${before} to ${after} (more than ±${MAX_MARKET_CHANGE * 100}%).`,
        );
      }
    }
  }
  return problems.length === 0 ? ok(true) : err(problems);
}
