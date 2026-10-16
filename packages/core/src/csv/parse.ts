import Papa from 'papaparse';
import { closestSymbols, exchangesForSymbol, findListing, searchInstruments } from '../instruments/search';
import {
  EXCHANGE_META,
  normalisePlatform,
  SymbolSchema,
  toInstrumentKey,
  type Exchange,
  type InstrumentKey,
} from '../models/primitives';
import { newBuyTransactionSchema, type NewBuyTransaction } from '../models/transaction';
import { normaliseCompanyName, similarity, utf8Length } from '../util/text';
import { findLikelyDuplicates } from './duplicates';
import {
  checkDate,
  closeHeaderMatch,
  normaliseExchange,
  parsePositiveNumber,
  REQUIRED_COLUMNS,
  resolveHeader,
} from './fields';
import {
  CSV_LIMITS,
  type CsvColumn,
  type CsvDeps,
  type CsvImportResult,
  type CsvIssue,
  type CsvIssueCode,
} from './types';

/** Name similarity below this produces a (non-blocking) name-mismatch warning. */
export const NAME_MISMATCH_THRESHOLD = 0.6;

type RawRow = { readonly line: number; readonly cells: readonly string[] };

const COLUMN_LABEL: Readonly<Record<CsvColumn, string>> = {
  symbol: 'Symbol',
  name: 'Name',
  exchange: 'Exchange',
  quantity: 'Quantity',
  buy_price: 'Buy price',
  buy_date: 'Buy date',
  platform: 'Platform',
  sector: 'Sector',
};

/** Splits the file into rows with their 1-based starting line (multi-line quoted fields handled). */
function readRows(text: string): RawRow[] {
  const rows: RawRow[] = [];
  let line = 1;
  let consumed = 0;
  Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimitersToGuess: [',', ';', '\t'],
    step: (result) => {
      const end = result.meta.cursor;
      const startLine = line;
      for (let i = consumed; i < end; i++) if (text.charCodeAt(i) === 10) line += 1;
      consumed = end;
      const cells = result.data.map((c) => c.trim());
      if (cells.some((c) => c !== '')) rows.push({ line: startLine, cells });
    },
  });
  return rows;
}

/**
 * Parses and validates a holdings CSV (LLD §2.9). All-or-nothing: any error means nothing is
 * imported, and every issue in the file is reported in one pass, sorted by line. Suggested fixes
 * are deterministic (no AI).
 */
export function parseHoldingsCsv(input: string, deps: CsvDeps): CsvImportResult {
  const errors: CsvIssue[] = [];
  const warnings: CsvIssue[] = [];
  const issue = (
    list: CsvIssue[],
    code: CsvIssueCode,
    message: string,
    o: {
      row?: number | null;
      preview?: string | null;
      column?: string | null;
      suggestion?: string | null;
    } = {},
  ): void => {
    list.push({
      fileName: deps.fileName,
      row: o.row ?? null,
      rowPreview: o.preview ?? null,
      column: o.column ?? null,
      code,
      message,
      suggestion: o.suggestion ?? null,
    });
  };
  const fail = (): CsvImportResult => ({
    ok: false,
    errors: errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)),
    warnings,
  });

  if (utf8Length(input) > CSV_LIMITS.maxBytes) {
    issue(errors, 'CSV_TOO_LARGE', 'The file is larger than 1 MB.', {
      suggestion: 'Split it into smaller files.',
    });
    return fail();
  }
  const rows = readRows(input.replace(/^﻿/, ''));
  const header = rows[0];
  if (!header || rows.length < 2) {
    issue(errors, 'CSV_EMPTY', 'The file has no data rows.', {
      suggestion: 'Add a header row and at least one buy.',
    });
    return fail();
  }
  if (rows.length - 1 > CSV_LIMITS.maxRows) {
    issue(errors, 'CSV_TOO_LARGE', `The file has more than ${CSV_LIMITS.maxRows} rows.`, {
      suggestion: 'Split it into smaller files.',
    });
    return fail();
  }

  // Header mapping
  const columnIndex = new Map<CsvColumn, number>();
  const unknown: { name: string; index: number }[] = [];
  header.cells.forEach((name, index) => {
    const col = resolveHeader(name);
    if (col && !columnIndex.has(col)) columnIndex.set(col, index);
    else if (name !== '') unknown.push({ name, index });
  });
  for (const col of REQUIRED_COLUMNS) {
    if (columnIndex.has(col)) continue;
    const near = unknown.find((u) => closeHeaderMatch(u.name) === col);
    issue(errors, 'CSV_MISSING_COLUMN', `Column \`${col}\` is missing.`, {
      row: 1,
      column: col,
      suggestion: near ? `Rename column \`${near.name}\` → \`${col}\`` : `Add column \`${col}\``,
    });
  }
  for (const u of unknown) {
    if (REQUIRED_COLUMNS.some((c) => !columnIndex.has(c) && closeHeaderMatch(u.name) === c)) continue;
    issue(warnings, 'CSV_UNKNOWN_COLUMN', `Column \`${u.name}\` is not used and will be ignored.`, {
      row: 1,
      column: u.name,
    });
  }
  if (errors.length > 0) return fail();

  const knownPlatforms = new Set(deps.knownPlatforms.map(normalisePlatform));
  const newPlatforms = new Map<string, string>();
  const sectorOverrides: Record<InstrumentKey, string> = {};
  const transactions: NewBuyTransaction[] = [];
  const schema = newBuyTransactionSchema(deps.today);

  for (const row of rows.slice(1)) {
    const cell = (col: CsvColumn): string => {
      const i = columnIndex.get(col);
      return i === undefined ? '' : (row.cells[i] ?? '');
    };
    const preview = [cell('symbol'), cell('exchange'), cell('buy_date')].filter(Boolean).join(' · ') || null;
    const err = (
      code: CsvIssueCode,
      column: CsvColumn | null,
      message: string,
      suggestion: string | null = null,
    ): void => issue(errors, code, message, { row: row.line, preview, column, suggestion });

    let missing = false;
    for (const col of REQUIRED_COLUMNS) {
      if (cell(col) === '') {
        err(
          'CSV_MISSING_VALUE',
          col,
          `${COLUMN_LABEL[col]} is empty.`,
          `Fill in \`${col}\` on line ${row.line}`,
        );
        missing = true;
      }
    }

    // Symbol + exchange
    let symbol: string | null = null;
    let exchange: Exchange | null = null;
    const rawSymbol = cell('symbol').toUpperCase();
    const rawExchange = cell('exchange');
    if (rawSymbol !== '') {
      const suffix = /^(.+)\.(NS|BO|BSE)$/.exec(rawSymbol);
      if (suffix) {
        const ex = suffix[2] === 'NS' ? 'NSE' : 'BSE';
        err(
          'CSV_SYMBOL_SUFFIX',
          'symbol',
          'Symbols must not include an exchange suffix.',
          `Use symbol \`${suffix[1]}\`, exchange \`${ex}\``,
        );
      } else {
        const parsed = SymbolSchema.safeParse(rawSymbol);
        if (parsed.success) symbol = parsed.data;
        else err('CSV_UNKNOWN_SYMBOL', 'symbol', `\`${rawSymbol}\` is not a valid ticker.`);
      }
    }
    if (rawExchange !== '') {
      exchange = normaliseExchange(rawExchange);
      if (!exchange) {
        err(
          'CSV_BAD_EXCHANGE',
          'exchange',
          `\`${rawExchange}\` is not a supported exchange.`,
          'Use one of NSE, BSE, NASDAQ, NYSE, NYSE_ARCA, NYSE_AMERICAN, CBOE',
        );
      }
    }
    const listing = symbol && exchange ? findListing(deps.index, exchange, symbol) : null;
    if (symbol && exchange && !listing) {
      err(
        'CSV_UNKNOWN_SYMBOL',
        'symbol',
        `\`${symbol}\` was not found on ${exchange}.`,
        suggestSymbol(deps, symbol, exchange, cell('name')),
      );
    }

    // Numbers
    let quantity: number | null = null;
    if (cell('quantity') !== '') {
      quantity = parsePositiveNumber(cell('quantity'));
      if (quantity === null || quantity > 1e9) {
        err(
          'CSV_BAD_NUMBER',
          'quantity',
          `\`${cell('quantity')}\` is not a valid quantity.`,
          'Quantity must be a positive number',
        );
        quantity = null;
      } else if (exchange && EXCHANGE_META[exchange].market === 'IN' && !Number.isInteger(quantity)) {
        err(
          'CSV_FRACTIONAL_IN',
          'quantity',
          'Indian shares must be whole numbers.',
          `Use a whole number instead of \`${cell('quantity')}\``,
        );
        quantity = null;
      }
    }
    let price: number | null = null;
    if (cell('buy_price') !== '') {
      price = parsePositiveNumber(cell('buy_price'));
      if (price === null || price > 1e7) {
        err(
          'CSV_BAD_NUMBER',
          'buy_price',
          `\`${cell('buy_price')}\` is not a valid price.`,
          'Buy price must be a positive number',
        );
        price = null;
      }
    }

    // Date
    let tradeDate: string | null = null;
    if (cell('buy_date') !== '') {
      const d = checkDate(cell('buy_date'), deps.today);
      if (d.ok) tradeDate = d.date;
      else err(d.code, 'buy_date', d.message, d.suggestion);
    }

    // Text lengths
    const name = cell('name');
    const platform = cell('platform');
    if (name.length > 120)
      err('CSV_TOO_LONG', 'name', 'Name is longer than 120 characters.', 'Shorten the name');
    if (platform.length > 40)
      err('CSV_TOO_LONG', 'platform', 'Platform is longer than 40 characters.', 'Shorten the platform name');

    if (
      missing ||
      !symbol ||
      !exchange ||
      !listing ||
      quantity === null ||
      price === null ||
      tradeDate === null
    )
      continue;
    if (name.length > 120 || platform.length > 40) continue;

    // Warnings
    const masterName = listing.instrument.name;
    if (similarity(normaliseCompanyName(name), normaliseCompanyName(masterName)) < NAME_MISMATCH_THRESHOLD) {
      issue(warnings, 'CSV_NAME_MISMATCH', `Master list name is \`${masterName}\`.`, {
        row: row.line,
        preview,
        column: 'name',
      });
    }
    const platformKey = normalisePlatform(platform);
    if (!knownPlatforms.has(platformKey) && !newPlatforms.has(platformKey)) {
      newPlatforms.set(platformKey, platform);
      issue(
        warnings,
        'CSV_NEW_PLATFORM',
        `\`${platform}\` is a new platform and will be added to your list.`,
        {
          row: row.line,
          preview,
          column: 'platform',
        },
      );
    }
    const sector = cell('sector');
    if (sector !== '') sectorOverrides[toInstrumentKey(exchange, symbol)] = sector.slice(0, 60);

    const parsed = schema.safeParse({
      type: 'BUY',
      symbol,
      exchange,
      name,
      platform,
      quantity,
      price,
      tradeDate,
      source: 'CSV',
    });
    if (parsed.success) transactions.push(parsed.data);
    else err('CSV_MISSING_VALUE', null, parsed.error.issues[0]?.message ?? 'Invalid row.');
  }

  if (errors.length > 0) return fail();
  return {
    ok: true,
    transactions,
    warnings: warnings.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)),
    likelyDuplicates: findLikelyDuplicates(transactions, deps.existing),
    newPlatforms: [...newPlatforms.values()],
    sectorOverrides,
  };
}

/** Up to 3 deterministic suggestions for an unknown symbol (LLD §2.9). */
function suggestSymbol(deps: CsvDeps, symbol: string, exchange: Exchange, name: string): string | null {
  const elsewhere = exchangesForSymbol(deps.index, symbol);
  if (elsewhere.length > 0) return `\`${symbol}\` is listed on \`${elsewhere.join('`, `')}\``;
  const market = EXCHANGE_META[exchange].market;
  const near = closestSymbols(deps.index, symbol, { market, limit: 3 }).map(
    (x) => `\`${x.listing.symbol}\` (${x.instrument.name}, ${x.listing.exchange})`,
  );
  if (near.length > 0) return `Did you mean ${near.join(' or ')}?`;
  if (name !== '') {
    const byName = searchInstruments(deps.index, name, { market, limit: 3 }).map(
      (h) => `\`${h.listing.symbol}\` (${h.instrument.name}, ${h.listing.exchange})`,
    );
    if (byName.length > 0) return `Did you mean ${byName.join(' or ')}?`;
  }
  return null;
}
