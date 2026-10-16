import { INSTRUMENT_TSV_COLUMNS, type InstrumentChunk } from '../models/instrument';
import {
  assembleChunks,
  buildMasterUpload,
  chunkId,
  chunkTsv,
  nextMasterVersion,
  utf8ByteLength,
} from './chunks';

const fakeHash = (s: string): string => (s.length.toString(16) + '0'.repeat(64)).slice(0, 64);

describe('utf8ByteLength', () => {
  it('counts 1–4 byte code points', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('₹')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('chunkTsv', () => {
  it('splits at line boundaries within the byte limit and round-trips', () => {
    const tsv = ['aaaa', 'bbbb', 'cccc', 'dd₹'].join('\n');
    const chunks = chunkTsv(tsv, 10);
    expect(chunks).toEqual(['aaaa\nbbbb\n', 'cccc\ndd₹']);
    expect(chunks.join('')).toBe(tsv);
    for (const c of chunks) expect(utf8ByteLength(c)).toBeLessThanOrEqual(10);
  });

  it('keeps everything in one chunk when it fits, and handles empty input', () => {
    expect(chunkTsv('a\nb')).toEqual(['a\nb']);
    expect(chunkTsv('')).toEqual([]);
  });

  it('rejects a single line longer than the limit', () => {
    expect(() => chunkTsv('short\nmuch too long', 8)).toThrow('line 2');
  });
});

describe('nextMasterVersion', () => {
  it('continues the counter on the same date, else restarts at 1', () => {
    expect(nextMasterVersion('2026-10-15', null)).toBe('2026-10-15.1');
    expect(nextMasterVersion('2026-10-15', '2026-10-15.3')).toBe('2026-10-15.4');
    expect(nextMasterVersion('2026-10-16', '2026-10-15.3')).toBe('2026-10-16.1');
    expect(nextMasterVersion('2026-10-16', 'garbage')).toBe('2026-10-16.1');
  });
});

describe('buildMasterUpload / assembleChunks', () => {
  const upload = buildMasterUpload({
    tsv: 'line-one\nline-two\nline-three',
    version: '2026-10-15.1',
    generatedAt: 1,
    sourceDates: { nse: '2026-10-15', bse: '2026-10-15', us: '2026-10-15' },
    counts: { total: 3, nse: 1, bse: 1, us: 1 },
    sha256: fakeHash,
    maxChunkBytes: 18,
  });

  it('builds chunk docs and a valid meta', () => {
    expect(upload.chunks.map((c) => c.id)).toEqual(['2026-10-15.1-0', '2026-10-15.1-1']);
    expect(upload.meta.chunkIds).toEqual(upload.chunks.map((c) => c.id));
    expect(upload.meta.columns).toBe(INSTRUMENT_TSV_COLUMNS);
    expect(upload.meta.sha256).toBe(fakeHash('line-one\nline-two\nline-three'));
    expect(chunkId('v', 2)).toBe('v-2');
  });

  it('reassembles chunks in index order regardless of arrival order', () => {
    const shuffled: InstrumentChunk[] = [...upload.chunks].reverse();
    const r = assembleChunks(upload.meta, shuffled);
    expect(r).toEqual({ ok: true, value: 'line-one\nline-two\nline-three' });
  });

  it('rejects missing chunks and chunks of another version', () => {
    expect(assembleChunks(upload.meta, upload.chunks.slice(0, 1))).toEqual({
      ok: false,
      error: 'MISSING_CHUNK',
    });
    const other = upload.chunks.map((c) => ({ ...c, version: '2026-10-14.1' }));
    expect(assembleChunks(upload.meta, other)).toEqual({ ok: false, error: 'VERSION_MISMATCH' });
  });
});
