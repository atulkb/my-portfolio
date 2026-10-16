import { z } from 'zod';
import { ExchangeSchema, IsoDateSchema, SymbolSchema } from './primitives';

export const InstrumentTypeSchema = z.enum(['EQUITY', 'ETF']);
/** Instrument kind from the exchange lists. */
export type InstrumentType = z.infer<typeof InstrumentTypeSchema>;

/** One exchange listing of an instrument. */
export const ListingSchema = z.object({
  exchange: ExchangeSchema,
  symbol: SymbolSchema,
  /** BSE numeric scrip code (e.g. "500325"); null otherwise. */
  providerCode: z.string().nullable(),
});
/** One exchange listing. */
export type Listing = z.infer<typeof ListingSchema>;

/** One company/fund; NSE and BSE listings merged by ISIN (HLD §15). */
export const InstrumentSchema = z.object({
  /** ISIN when known, else "<EXCHANGE>:<SYMBOL>" of the primary listing. */
  id: z.string().min(1),
  name: z.string().min(1).max(160),
  isin: z
    .string()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/)
    .nullable(),
  type: InstrumentTypeSchema,
  listings: z.array(ListingSchema).min(1).max(2),
  /** BSE only; sector for held stocks comes from market data. */
  industry: z.string().nullable(),
});
/** Master-list instrument. */
export type Instrument = z.infer<typeof InstrumentSchema>;

/** Column order of the packed TSV (meta.columns must equal this). */
export const INSTRUMENT_TSV_COLUMNS = 'id\tname\tisin\ttype\tnse\tbse\tbseCode\tus\tusExchange\tindustry';

/** Maximum characters of TSV per chunk document (Firestore doc limit is 1 MiB). */
export const MAX_CHUNK_CHARS = 900_000;

/** `reference/instruments` meta document, written LAST by the sync. */
export const InstrumentMasterMetaSchema = z.object({
  schemaVersion: z.literal(1),
  /** e.g. "2026-10-15.1". */
  version: z.string().min(1),
  generatedAt: z.number(),
  sourceDates: z.object({ nse: IsoDateSchema, bse: IsoDateSchema, us: IsoDateSchema }),
  counts: z.object({
    total: z.number().int(),
    nse: z.number().int(),
    bse: z.number().int(),
    us: z.number().int(),
  }),
  chunkIds: z.array(z.string()).min(1).max(10),
  /** Over the concatenated chunk texts, in chunkIds order. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  columns: z.literal(INSTRUMENT_TSV_COLUMNS),
});
/** Instrument master meta document. */
export type InstrumentMasterMeta = z.infer<typeof InstrumentMasterMetaSchema>;

/** `reference/instruments/chunks/{version}-{index}`. */
export const InstrumentChunkSchema = z.object({
  schemaVersion: z.literal(1),
  /** Must equal meta.version. */
  version: z.string().min(1),
  index: z.number().int().min(0),
  /** One instrument per line, columns as in meta.columns, "" = null. */
  tsv: z.string().max(MAX_CHUNK_CHARS),
});
/** Instrument master chunk document. */
export type InstrumentChunk = z.infer<typeof InstrumentChunkSchema>;
