import { createHash } from 'node:crypto';

import type { InstrumentChunk, InstrumentMasterMeta } from '@portfolio/core';

import { isoDaysBefore } from './download';
import { isCredentialError } from './firestore';
import { maxSourceDate, snapshotDates } from './snapshot';
import { executeUpload, planUpload, type BuildOutput, type MasterStore } from './upload';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const counts = { total: 18_000, nse: 2_600, bse: 5_000, us: 12_800 };
const build: BuildOutput = {
  tsv: 'a\tb\nc\td',
  sourceDates: { nse: '2026-10-15', bse: '2026-10-14', us: '2026-10-15' },
  counts,
};

function liveMeta(over: Partial<InstrumentMasterMeta> = {}): InstrumentMasterMeta {
  return {
    schemaVersion: 1,
    version: '2026-10-15.1',
    generatedAt: 0,
    sourceDates: build.sourceDates,
    counts,
    chunkIds: ['2026-10-15.1-0'],
    sha256: sha256('old'),
    columns: 'id\tname\tisin\ttype\tnse\tbse\tbseCode\tus\tusExchange\tindustry',
    ...over,
  };
}

describe('snapshotDates', () => {
  it('takes BSE from the newest bhavcopy name and NSE/US from the folder', () => {
    const r = snapshotDates('data/instruments/snapshot-2026-10-16', [
      'nse_equity_list.csv',
      'bse_bhavcopy_2026-10-14.csv',
      'bse_bhavcopy_2026-10-15.csv',
    ]);
    expect(r.bseFile).toBe('bse_bhavcopy_2026-10-15.csv');
    expect(r.sourceDates).toEqual({ nse: '2026-10-16', bse: '2026-10-15', us: '2026-10-16' });
    expect(maxSourceDate(r.sourceDates)).toBe('2026-10-16');
  });

  it('rejects badly named folders and missing bhavcopy', () => {
    expect(() => snapshotDates('data/instruments/latest', [])).toThrow('snapshot-YYYY-MM-DD');
    expect(() => snapshotDates('snapshot-2026-10-16', ['x.csv'])).toThrow('bse_bhavcopy');
  });
});

describe('planUpload', () => {
  const opts = { now: 1, sha256 };

  it('first upload: version <max date>.1', () => {
    const plan = planUpload(build, null, opts);
    expect(plan.kind).toBe('upload');
    if (plan.kind !== 'upload') return;
    expect(plan.upload.meta.version).toBe('2026-10-15.1');
    expect(plan.upload.meta.sha256).toBe(sha256(build.tsv));
    expect(plan.live).toBeNull();
  });

  it('same date as live: bumps the counter', () => {
    const plan = planUpload(build, liveMeta(), opts);
    expect(plan.kind === 'upload' && plan.upload.meta.version).toBe('2026-10-15.2');
  });

  it('unchanged when the live hash matches', () => {
    expect(planUpload(build, liveMeta({ sha256: sha256(build.tsv) }), opts).kind).toBe('unchanged');
  });

  it('rejects a market moving more than 20 % versus live', () => {
    const plan = planUpload(build, liveMeta({ counts: { ...counts, us: 8_000 } }), opts);
    expect(plan.kind).toBe('rejected');
  });

  it('treats an invalid live meta as absent', () => {
    expect(planUpload(build, { junk: true }, opts).kind).toBe('upload');
  });
});

describe('executeUpload', () => {
  it('writes chunks, then meta, then deletes other versions', async () => {
    const calls: string[] = [];
    const store: MasterStore = {
      getMeta: () => Promise.resolve(null),
      listChunkIds: () => Promise.resolve(['2026-10-14.1-0', '2026-10-14.1-1', '2026-10-15.1-0']),
      writeChunk: (id: string, _c: InstrumentChunk) => {
        calls.push(`chunk ${id}`);
        return Promise.resolve();
      },
      writeMeta: (m) => {
        calls.push(`meta ${m.version}`);
        return Promise.resolve();
      },
      deleteChunks: (ids) => {
        calls.push(`delete ${ids.join(',')}`);
        return Promise.resolve();
      },
    };
    const plan = planUpload(build, null, { now: 1, sha256 });
    if (plan.kind !== 'upload') throw new Error('expected upload');
    const deleted = await executeUpload(store, plan.upload);
    expect(calls).toEqual([
      'chunk 2026-10-15.1-0',
      'meta 2026-10-15.1',
      'delete 2026-10-14.1-0,2026-10-14.1-1',
    ]);
    expect(deleted).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('isoDaysBefore crosses month boundaries', () => {
    expect(isoDaysBefore('2026-11-01', 1)).toBe('2026-10-31');
    expect(isoDaysBefore('2026-10-16', 0)).toBe('2026-10-16');
  });

  it('recognises credential errors', () => {
    expect(isCredentialError(new Error('Could not load the default credentials.'))).toBe(true);
    expect(isCredentialError(new Error('HTTP 500'))).toBe(false);
  });
});
