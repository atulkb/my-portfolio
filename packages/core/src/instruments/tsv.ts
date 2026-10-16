import {
  INSTRUMENT_TSV_COLUMNS,
  type Instrument,
  type InstrumentType,
  type Listing,
} from '../models/instrument';
import { EXCHANGE_META, ExchangeSchema, type Exchange } from '../models/primitives';

const COLUMN_COUNT = INSTRUMENT_TSV_COLUMNS.split('\t').length;

/** Removes characters that would break the TSV layout. */
export function sanitiseField(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ').trim();
}

/** Serialises one instrument as a TSV line (columns per {@link INSTRUMENT_TSV_COLUMNS}, "" = null). */
export function instrumentToTsvLine(i: Instrument): string {
  const nse = i.listings.find((l) => l.exchange === 'NSE');
  const bse = i.listings.find((l) => l.exchange === 'BSE');
  const us = i.listings.find((l) => EXCHANGE_META[l.exchange].market === 'US');
  return [
    i.id,
    i.name,
    i.isin ?? '',
    i.type,
    nse?.symbol ?? '',
    bse?.symbol ?? '',
    bse?.providerCode ?? '',
    us?.symbol ?? '',
    us?.exchange ?? '',
    i.industry ?? '',
  ]
    .map(sanitiseField)
    .join('\t');
}

/** Serialises instruments in the given order, one per line, no header (the meta doc holds the columns). */
export function instrumentsToTsv(instruments: readonly Instrument[]): string {
  return instruments.map(instrumentToTsvLine).join('\n');
}

/**
 * Parses the packed TSV back into instruments. Malformed lines (wrong column count, unknown
 * exchange, no listing) are skipped and counted rather than failing the whole list.
 */
export function parseInstrumentTsv(tsv: string): { instruments: Instrument[]; skipped: number } {
  const instruments: Instrument[] = [];
  let skipped = 0;
  for (const line of tsv.split('\n')) {
    if (line === '') continue;
    const cols = line.split('\t');
    if (cols.length !== COLUMN_COUNT) {
      skipped += 1;
      continue;
    }
    const [id, name, isin, type, nse, bse, bseCode, us, usExchange, industry] = cols as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const listings: Listing[] = [];
    if (nse) listings.push({ exchange: 'NSE', symbol: nse, providerCode: null });
    if (bse) listings.push({ exchange: 'BSE', symbol: bse, providerCode: bseCode || null });
    if (us) {
      const ex = ExchangeSchema.safeParse(usExchange);
      if (!ex.success || EXCHANGE_META[ex.data as Exchange].market !== 'US') {
        skipped += 1;
        continue;
      }
      listings.push({ exchange: ex.data, symbol: us, providerCode: null });
    }
    if (listings.length === 0 || (type !== 'EQUITY' && type !== 'ETF')) {
      skipped += 1;
      continue;
    }
    instruments.push({
      id,
      name,
      isin: isin || null,
      type: type as InstrumentType,
      listings,
      industry: industry || null,
    });
  }
  return { instruments, skipped };
}
