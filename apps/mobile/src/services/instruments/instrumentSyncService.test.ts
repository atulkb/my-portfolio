import {
  AppError,
  buildMasterUpload,
  type InstrumentChunk,
  type InstrumentMasterMeta,
  type InstrumentMasterRepository,
} from '@portfolio/core';
import { z } from 'zod';

import { KV_KEYS } from '../cache/keys';
import { createKeyValueCache, memoryRawStore } from '../cache/kv';
import { CHECK_INTERVAL_MS, createInstrumentSyncService } from './instrumentSyncService';

// Deterministic stand-in hash: real SHA-256 is expo-crypto's job.
const fakeSha = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(64, '0');
};

const TSV =
  'INE002A01018\tReliance Industries\tINE002A01018\tEQUITY\tRELIANCE\tRELIANCE\t500325\t\t\t\nUS:AAPL\tApple Inc.\t\tEQUITY\t\t\t\tAAPL\tNASDAQ\t';

function upload(version: string, tsv = TSV) {
  return buildMasterUpload({
    tsv,
    version,
    generatedAt: 1,
    sourceDates: { nse: '2026-10-15', bse: '2026-10-15', us: '2026-10-15' },
    counts: { total: 2, nse: 1, bse: 1, us: 1 },
    sha256: fakeSha,
    maxChunkBytes: 100,
  });
}

function setup(
  opts: { meta?: InstrumentMasterMeta | null; chunks?: InstrumentChunk[]; failMeta?: boolean } = {},
) {
  const u = upload('2026-10-15.1');
  const meta = opts.meta === undefined ? u.meta : opts.meta;
  const repo: InstrumentMasterRepository & { metaCalls: number; chunkCalls: number } = {
    metaCalls: 0,
    chunkCalls: 0,
    getMeta() {
      this.metaCalls += 1;
      return opts.failMeta ? Promise.reject(new AppError('FS_UNAVAILABLE')) : Promise.resolve(meta);
    },
    getChunks() {
      this.chunkCalls += 1;
      return Promise.resolve(opts.chunks ?? u.chunks.map(({ id: _id, ...c }) => c));
    },
  };
  const raw = memoryRawStore();
  const kv = createKeyValueCache(raw);
  let now = 1_000_000;
  const clock = { now: () => now };
  const sync = createInstrumentSyncService({ repo, kv, clock, sha256: (s) => Promise.resolve(fakeSha(s)) });
  return { sync, repo, kv, raw, u, advance: (ms: number) => (now += ms) };
}

describe('instrumentSyncService', () => {
  it('downloads, verifies and stores the list on first launch', async () => {
    const { sync, repo, kv, u } = setup();
    expect(u.chunks.length).toBeGreaterThan(1);
    const r = await sync.ensureFresh();
    expect(r.kind).toBe('updated');
    expect(r.kind === 'updated' && r.tsv).toBe(TSV);
    expect(repo.chunkCalls).toBe(1);
    expect(kv.get(KV_KEYS.instrumentsTsv, z.string())).toBe(TSV);
    expect(sync.loadLocal()?.meta.version).toBe('2026-10-15.1');
  });

  it('skips the network within 24 h, then checks the meta only when unchanged', async () => {
    const { sync, repo, advance } = setup();
    await sync.ensureFresh();
    expect((await sync.ensureFresh()).kind).toBe('skipped');
    expect(repo.metaCalls).toBe(1);
    advance(CHECK_INTERVAL_MS);
    expect((await sync.ensureFresh()).kind).toBe('upToDate');
    expect(repo.metaCalls).toBe(2);
    expect(repo.chunkCalls).toBe(1);
  });

  it('force ignores the 24 h throttle', async () => {
    const { sync, repo } = setup();
    await sync.ensureFresh();
    expect((await sync.ensureFresh({ force: true })).kind).toBe('upToDate');
    expect(repo.metaCalls).toBe(2);
  });

  it('rejects a hash mismatch and keeps nothing', async () => {
    const bad = upload('2026-10-15.1').chunks.map(({ id: _id, ...c }, i) =>
      i === 0 ? { ...c, tsv: `${c.tsv}x` } : c,
    );
    const { sync, raw } = setup({ chunks: bad });
    const r = await sync.ensureFresh();
    expect(r.kind === 'failed' && r.error.code).toBe('SYNC_HASH_MISMATCH');
    expect(raw.data.size).toBe(0);
  });

  it('rejects chunks from another version', async () => {
    const other = upload('2026-10-14.1').chunks.map(({ id: _id, ...c }) => c);
    const { sync } = setup({ chunks: other });
    const r = await sync.ensureFresh();
    expect(r.kind === 'failed' && r.error.code).toBe('SYNC_FAILED');
  });

  it('offline: reports the failure and keeps the previous copy', async () => {
    const first = setup();
    await first.sync.ensureFresh();
    const offline = createInstrumentSyncService({
      repo: {
        getMeta: () => Promise.reject(new AppError('FS_UNAVAILABLE')),
        getChunks: () => Promise.resolve([]),
      },
      kv: first.kv,
      clock: { now: () => Number.MAX_SAFE_INTEGER },
      sha256: (s) => Promise.resolve(fakeSha(s)),
    });
    const r = await offline.ensureFresh();
    expect(r.kind === 'failed' && r.error.code).toBe('FS_UNAVAILABLE');
    expect(offline.loadLocal()?.tsv).toBe(TSV);
  });

  it('no meta published yet → SYNC_FAILED', async () => {
    const { sync } = setup({ meta: null });
    const r = await sync.ensureFresh();
    expect(r.kind === 'failed' && r.error.code).toBe('SYNC_FAILED');
  });
});

describe('keyValueCache', () => {
  it('drops values that fail the schema or are not JSON', () => {
    const raw = memoryRawStore({ a: '"text"', b: '{oops', c: '42' });
    const kv = createKeyValueCache(raw);
    expect(kv.get('a', z.number())).toBeNull();
    expect(kv.get('b', z.string())).toBeNull();
    expect(kv.get('c', z.number())).toBe(42);
    expect([...raw.data.keys()]).toEqual(['c']);
    kv.set('instruments.x', 1);
    expect(kv.keys('instruments.')).toEqual(['instruments.x']);
    kv.delete('c');
    expect(kv.get('c', z.number())).toBeNull();
  });
});
