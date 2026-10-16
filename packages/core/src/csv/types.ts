import type { InstrumentIndex } from '../instruments/search';
import type { InstrumentKey, IsoDate } from '../models/primitives';
import type { BuyTransaction, NewBuyTransaction } from '../models/transaction';
import type { DuplicateGroup } from './duplicates';

/** Error codes block the import; warning codes never do (LLD §2.9). */
export type CsvErrorCode =
  | 'CSV_MISSING_COLUMN'
  | 'CSV_SYMBOL_SUFFIX'
  | 'CSV_UNKNOWN_SYMBOL'
  | 'CSV_BAD_EXCHANGE'
  | 'CSV_BAD_DATE'
  | 'CSV_AMBIGUOUS_DATE'
  | 'CSV_DATE_FORMAT'
  | 'CSV_FUTURE_DATE'
  | 'CSV_DATE_TOO_OLD'
  | 'CSV_BAD_NUMBER'
  | 'CSV_FRACTIONAL_IN'
  | 'CSV_MISSING_VALUE'
  | 'CSV_TOO_LONG'
  | 'CSV_TOO_LARGE'
  | 'CSV_EMPTY';
export type CsvWarningCode = 'CSV_NAME_MISMATCH' | 'CSV_UNKNOWN_COLUMN' | 'CSV_NEW_PLATFORM';
export type CsvIssueCode = CsvErrorCode | CsvWarningCode;

/**
 * One problem, as shown in the error sheet. `row` is the 1-based file line (header = line 1,
 * matching a spreadsheet). Row references exist only here and are never stored.
 */
export type CsvIssue = {
  readonly fileName: string;
  readonly row: number | null;
  /** `symbol · exchange · buy_date` as written in the file. */
  readonly rowPreview: string | null;
  readonly column: string | null;
  readonly code: CsvIssueCode;
  readonly message: string;
  readonly suggestion: string | null;
};

/** Dependencies for parsing; `today` is passed in to keep core clock-free. */
export type CsvDeps = {
  readonly fileName: string;
  readonly today: IsoDate;
  readonly index: InstrumentIndex;
  readonly existing: readonly BuyTransaction[];
  readonly knownPlatforms: readonly string[];
};

/** All-or-nothing outcome (HLD §7). */
export type CsvImportResult =
  | { readonly ok: false; readonly errors: CsvIssue[]; readonly warnings: CsvIssue[] }
  | {
      readonly ok: true;
      readonly transactions: NewBuyTransaction[];
      readonly warnings: CsvIssue[];
      readonly likelyDuplicates: DuplicateGroup[];
      readonly newPlatforms: string[];
      readonly sectorOverrides: Record<InstrumentKey, string>;
    };

/** Canonical CSV columns. */
export const CSV_COLUMNS = [
  'symbol',
  'name',
  'exchange',
  'quantity',
  'buy_price',
  'buy_date',
  'platform',
  'sector',
] as const;
/** One canonical CSV column. */
export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Limits (LLD §2.9). */
export const CSV_LIMITS = { maxBytes: 1_048_576, maxRows: 2000 } as const;
