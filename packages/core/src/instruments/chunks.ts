import {
  INSTRUMENT_TSV_COLUMNS,
  InstrumentMasterMetaSchema,
  MAX_CHUNK_CHARS,
  type InstrumentChunk,
  type InstrumentMasterMeta,
} from '../models/instrument';
import type { IsoDate } from '../models/primitives';
import { err, ok, type Result } from '../util/result';

/** UTF-8 byte length of a string (no TextEncoder needed). */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // Surrogate pair = one 4-byte code point.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Splits the master TSV at line boundaries so every chunk is at most `maxBytes` UTF-8 bytes
 * (LLD §3.6). Concatenating the chunks with no separator gives back the input exactly: every
 * chunk but the last keeps its trailing newline.
 */
export function chunkTsv(tsv: string, maxBytes: number = MAX_CHUNK_CHARS): string[] {
  if (tsv === '') return [];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  const lines = tsv.split('\n');
  lines.forEach((line, i) => {
    const piece = i < lines.length - 1 ? `${line}\n` : line;
    const bytes = utf8ByteLength(piece);
    if (bytes > maxBytes) throw new Error(`TSV line ${i + 1} is longer than ${maxBytes} bytes.`);
    if (currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += piece;
    currentBytes += bytes;
  });
  if (current !== '') chunks.push(current);
  return chunks;
}

const VERSION_RE = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;

/**
 * Next master version `<max source date>.<n>`: `n` continues from the live version when it has
 * the same date, otherwise starts at 1.
 */
export function nextMasterVersion(maxSourceDate: IsoDate, liveVersion: string | null): string {
  const m = liveVersion ? VERSION_RE.exec(liveVersion) : null;
  const n = m && m[1] === maxSourceDate ? Number(m[2]) + 1 : 1;
  return `${maxSourceDate}.${n}`;
}

/** Firestore id of chunk `index` of `version`. */
export function chunkId(version: string, index: number): string {
  return `${version}-${index}`;
}

/** Everything the sync uploads for one version: chunk documents plus the meta document. */
export type MasterUpload = {
  readonly meta: InstrumentMasterMeta;
  readonly chunks: readonly (InstrumentChunk & { readonly id: string })[];
};

/** Inputs for {@link buildMasterUpload}; `sha256` is computed by the caller (no crypto in core). */
export type MasterUploadInput = {
  readonly tsv: string;
  readonly version: string;
  readonly generatedAt: number;
  readonly sourceDates: InstrumentMasterMeta['sourceDates'];
  readonly counts: InstrumentMasterMeta['counts'];
  readonly sha256: (text: string) => string;
  readonly maxChunkBytes?: number;
};

/** Chunks the TSV and builds the meta document, validated against the schemas. */
export function buildMasterUpload(input: MasterUploadInput): MasterUpload {
  const texts = chunkTsv(input.tsv, input.maxChunkBytes);
  const chunks = texts.map((tsv, index) => ({
    id: chunkId(input.version, index),
    schemaVersion: 1 as const,
    version: input.version,
    index,
    tsv,
  }));
  const meta = InstrumentMasterMetaSchema.parse({
    schemaVersion: 1,
    version: input.version,
    generatedAt: input.generatedAt,
    sourceDates: input.sourceDates,
    counts: input.counts,
    chunkIds: chunks.map((c) => c.id),
    sha256: input.sha256(texts.join('')),
    columns: INSTRUMENT_TSV_COLUMNS,
  });
  return { meta, chunks };
}

/** Why downloaded chunks were rejected. */
export type ChunkProblem = 'MISSING_CHUNK' | 'VERSION_MISMATCH';

/**
 * Orders downloaded chunks as in `meta.chunkIds` and checks they all belong to `meta.version`;
 * returns the concatenated TSV (the caller then verifies `meta.sha256`).
 */
export function assembleChunks(
  meta: InstrumentMasterMeta,
  chunks: readonly InstrumentChunk[],
): Result<string, ChunkProblem> {
  if (chunks.some((c) => c.version !== meta.version)) return err('VERSION_MISMATCH');
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  if (sorted.length !== meta.chunkIds.length || sorted.some((c, i) => c.index !== i))
    return err('MISSING_CHUNK');
  return ok(sorted.map((c) => c.tsv).join(''));
}
