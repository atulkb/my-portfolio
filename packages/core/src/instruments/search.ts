import type { Instrument, Listing } from '../models/instrument';
import {
  EXCHANGE_META,
  toInstrumentKey,
  type Exchange,
  type InstrumentKey,
  type Market,
} from '../models/primitives';
import { editDistance } from '../util/text';

type Entry = {
  readonly instrument: Instrument;
  readonly nameUpper: string;
  readonly nameWords: readonly string[];
  readonly markets: readonly Market[];
  readonly preferred: boolean;
};

/** In-memory search index over the master list, built once after load. */
export type InstrumentIndex = {
  readonly instruments: readonly Instrument[];
  readonly entries: readonly Entry[];
  readonly byKey: ReadonlyMap<InstrumentKey, { readonly instrument: Instrument; readonly listing: Listing }>;
  readonly bySymbol: ReadonlyMap<
    string,
    readonly { readonly instrument: Instrument; readonly listing: Listing }[]
  >;
};

/** How a search hit matched, best first. */
export type MatchKind = 'EXACT_SYMBOL' | 'SYMBOL_PREFIX' | 'NAME_WORD_PREFIX' | 'NAME_CONTAINS';

/** One search result: an instrument and its most relevant listing. */
export type SearchHit = {
  readonly instrument: Instrument;
  readonly listing: Listing;
  readonly match: MatchKind;
};

const RANK: Readonly<Record<MatchKind, number>> = {
  EXACT_SYMBOL: 0,
  SYMBOL_PREFIX: 1,
  NAME_WORD_PREFIX: 2,
  NAME_CONTAINS: 3,
};
const PREFERRED_EXCHANGES: readonly Exchange[] = ['NSE', 'NASDAQ', 'NYSE'];

const words = (s: string): string[] =>
  s
    .toUpperCase()
    .split(/[^A-Z0-9&]+/)
    .filter(Boolean);

/** Builds the search index (~20k instruments; a linear scan per query is < 10 ms). */
export function buildInstrumentIndex(instruments: readonly Instrument[]): InstrumentIndex {
  const byKey = new Map<InstrumentKey, { instrument: Instrument; listing: Listing }>();
  const bySymbol = new Map<string, { instrument: Instrument; listing: Listing }[]>();
  const entries: Entry[] = instruments.map((instrument) => {
    for (const listing of instrument.listings) {
      byKey.set(toInstrumentKey(listing.exchange, listing.symbol), { instrument, listing });
      const list = bySymbol.get(listing.symbol);
      if (list) list.push({ instrument, listing });
      else bySymbol.set(listing.symbol, [{ instrument, listing }]);
    }
    return {
      instrument,
      nameUpper: instrument.name.toUpperCase(),
      nameWords: words(instrument.name),
      markets: [...new Set(instrument.listings.map((l) => EXCHANGE_META[l.exchange].market))],
      preferred: instrument.listings.some((l) => PREFERRED_EXCHANGES.includes(l.exchange)),
    };
  });
  return { instruments, entries, byKey, bySymbol };
}

/** Uppercases, trims and strips Yahoo-style suffixes (`INFY.NS` → `INFY`). */
export function normaliseQuery(q: string): string {
  return q
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|BSE)$/, '');
}

function bestListing(instrument: Instrument, symbol: string | null, market: Market | undefined): Listing {
  const pool = instrument.listings.filter(
    (l) => market === undefined || EXCHANGE_META[l.exchange].market === market,
  );
  const candidates = pool.length > 0 ? pool : instrument.listings;
  return (
    (symbol !== null ? candidates.find((l) => l.symbol === symbol) : undefined) ??
    candidates.find((l) => PREFERRED_EXCHANGES.includes(l.exchange)) ??
    (candidates[0] as Listing)
  );
}

/**
 * Ranked search (HLD §15, LLD §2.10): exact symbol, symbol prefix, name word-prefix (every query
 * token prefixes a name word), name substring. Ties: NSE/NASDAQ/NYSE listings first, then the
 * shorter name. Respects an optional market filter.
 */
export function searchInstruments(
  index: InstrumentIndex,
  query: string,
  opts: { market?: Market; limit?: number } = {},
): SearchHit[] {
  const q = normaliseQuery(query);
  if (q === '') return [];
  const tokens = words(q);
  const limit = opts.limit ?? 20;
  const scored: { hit: SearchHit; rank: number; entry: Entry }[] = [];

  for (const entry of index.entries) {
    if (opts.market && !entry.markets.includes(opts.market)) continue;
    let match: MatchKind | null = null;
    let matchedSymbol: string | null = null;
    for (const l of entry.instrument.listings) {
      if (opts.market && EXCHANGE_META[l.exchange].market !== opts.market) continue;
      if (l.symbol === q) {
        match = 'EXACT_SYMBOL';
        matchedSymbol = l.symbol;
        break;
      }
      if (l.symbol.startsWith(q) && match === null) {
        match = 'SYMBOL_PREFIX';
        matchedSymbol = l.symbol;
      }
    }
    if (
      match === null &&
      tokens.length > 0 &&
      tokens.every((t) => entry.nameWords.some((w) => w.startsWith(t)))
    ) {
      match = 'NAME_WORD_PREFIX';
    }
    if (match === null && q.length >= 3 && entry.nameUpper.includes(q)) match = 'NAME_CONTAINS';
    if (match === null) continue;
    scored.push({
      hit: {
        instrument: entry.instrument,
        listing: bestListing(entry.instrument, matchedSymbol, opts.market),
        match,
      },
      rank: RANK[match],
      entry,
    });
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.entry.preferred) - Number(a.entry.preferred) ||
      a.entry.instrument.name.length - b.entry.instrument.name.length ||
      a.entry.instrument.id.localeCompare(b.entry.instrument.id),
  );
  return scored.slice(0, limit).map((s) => s.hit);
}

/** Exact listing lookup by exchange and symbol. */
export function findListing(
  index: InstrumentIndex,
  exchange: Exchange,
  symbol: string,
): { instrument: Instrument; listing: Listing } | null {
  return index.byKey.get(toInstrumentKey(exchange, symbol)) ?? null;
}

/** Exchanges on which a symbol is listed (e.g. `AAPL` → `['NASDAQ']`). */
export function exchangesForSymbol(index: InstrumentIndex, symbol: string): Exchange[] {
  return (index.bySymbol.get(symbol) ?? []).map((x) => x.listing.exchange);
}

/**
 * Closest symbols by Damerau-Levenshtein distance (≤ `maxDistance`), used for "Did you mean…?"
 * suggestions. Optionally limited to one market.
 */
export function closestSymbols(
  index: InstrumentIndex,
  symbol: string,
  opts: { market?: Market; maxDistance?: number; limit?: number } = {},
): { instrument: Instrument; listing: Listing; distance: number }[] {
  const max = opts.maxDistance ?? 2;
  const out: { instrument: Instrument; listing: Listing; distance: number }[] = [];
  for (const [sym, listings] of index.bySymbol) {
    if (Math.abs(sym.length - symbol.length) > max) continue;
    const d = editDistance(symbol, sym, max);
    if (d > max || d === 0) continue;
    for (const x of listings) {
      if (opts.market && EXCHANGE_META[x.listing.exchange].market !== opts.market) continue;
      out.push({ ...x, distance: d });
    }
  }
  out.sort(
    (a, b) =>
      a.distance - b.distance ||
      Number(PREFERRED_EXCHANGES.includes(b.listing.exchange)) -
        Number(PREFERRED_EXCHANGES.includes(a.listing.exchange)) ||
      a.listing.symbol.localeCompare(b.listing.symbol),
  );
  return out.slice(0, opts.limit ?? 3);
}
