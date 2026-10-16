import {
  AppError,
  buildInstrumentIndex,
  parseInstrumentTsv,
  type InstrumentIndex,
  type InstrumentMasterMeta,
} from '@portfolio/core';

import type {
  InstrumentSyncService,
  LocalMaster,
  SyncOutcome,
} from '@/services/instruments/instrumentSyncService';
import { createInstrumentStore } from './instrumentStore';

const TSV =
  'INE002A01018\tReliance Industries\tINE002A01018\tEQUITY\tRELIANCE\tRELIANCE\t500325\t\t\t\nUS:AAPL\tApple Inc.\t\tEQUITY\t\t\t\tAAPL\tNASDAQ\t';

const meta = { version: '2026-10-15.1', counts: { total: 2 } } as unknown as InstrumentMasterMeta;

function setup(local: LocalMaster | null, outcome: SyncOutcome) {
  let index: InstrumentIndex | null = null;
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const sync: InstrumentSyncService = {
    loadLocal: () => local,
    ensureFresh: async () => {
      calls += 1;
      await gate;
      return outcome;
    },
  };
  const store = createInstrumentStore({
    sync,
    getIndex: () => index,
    setIndexFromTsv: (tsv) => {
      const { instruments, skipped } = parseInstrumentTsv(tsv);
      index = buildInstrumentIndex(instruments);
      return { count: instruments.length, skipped };
    },
    clearIndex: () => (index = null),
  });
  return { store, release, calls: () => calls };
}

describe('instrumentStore', () => {
  it('a fresh store over an already-parsed index still reports ready (no download)', async () => {
    const first = setup({ meta, tsv: TSV }, { kind: 'skipped' });
    first.release();
    await first.store.getState().ensureFresh();
    // A second store sharing the same index singleton (e.g. after a dev reload of the stores).
    let index: InstrumentIndex | null = null;
    const second = createInstrumentStore({
      sync: { loadLocal: () => ({ meta, tsv: TSV }), ensureFresh: async () => ({ kind: 'skipped' }) },
      getIndex: () => index ?? buildInstrumentIndex(parseInstrumentTsv(TSV).instruments),
      setIndexFromTsv: (tsv) => {
        const { instruments, skipped } = parseInstrumentTsv(tsv);
        index = buildInstrumentIndex(instruments);
        return { count: instruments.length, skipped };
      },
      clearIndex: () => (index = null),
    });
    await second.getState().ensureFresh();
    expect(second.getState().status).toBe('ready');
    expect(second.getState().meta).toBe(meta);
  });

  it('first launch: downloading → ready, then search and resolve work', async () => {
    const { store, release } = setup(null, { kind: 'updated', meta, tsv: TSV });
    const p = store.getState().ensureFresh();
    expect(store.getState().status).toBe('downloading');
    expect(store.getState().search('REL')).toEqual([]);
    release();
    await p;
    expect(store.getState().status).toBe('ready');
    expect(store.getState().search('REL')[0]?.listing.symbol).toBe('RELIANCE');
    expect(store.getState().search('apple', 'IN')).toEqual([]);
    expect(store.getState().resolve('NASDAQ', 'AAPL')?.instrument.name).toBe('Apple Inc.');
  });

  it('uses the local copy immediately and keeps it when the check fails', async () => {
    const { store, release } = setup(
      { meta, tsv: TSV },
      { kind: 'failed', error: new AppError('FS_UNAVAILABLE') },
    );
    const p = store.getState().ensureFresh();
    expect(store.getState().status).toBe('ready');
    release();
    await p;
    expect(store.getState().status).toBe('ready');
    expect(store.getState().error).toBe('FS_UNAVAILABLE');
    expect(store.getState().search('AAPL')).toHaveLength(1);
  });

  it('no copy and the download fails → error', async () => {
    const { store, release } = setup(null, { kind: 'failed', error: new AppError('SYNC_HASH_MISMATCH') });
    const p = store.getState().ensureFresh();
    release();
    await p;
    expect(store.getState().status).toBe('error');
  });

  it('joins a running check and resets on sign-out', async () => {
    const { store, release, calls } = setup(null, { kind: 'updated', meta, tsv: TSV });
    const a = store.getState().ensureFresh();
    const b = store.getState().ensureFresh();
    release();
    await Promise.all([a, b]);
    expect(calls()).toBe(1);
    store.getState().reset();
    expect(store.getState().status).toBe('missing');
    expect(store.getState().meta).toBeNull();
    expect(store.getState().search('AAPL')).toEqual([]);
  });
});
