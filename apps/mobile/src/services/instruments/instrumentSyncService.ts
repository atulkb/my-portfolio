import {
  AppError,
  assembleChunks,
  InstrumentMasterMetaSchema,
  toAppError,
  type Clock,
  type InstrumentMasterMeta,
  type InstrumentMasterRepository,
  type KeyValueCache,
} from '@portfolio/core';
import { z } from 'zod';

import { KV_KEYS } from '../cache/keys';

/** Minimum time between version checks (LLD §3.6 step 1). */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Outcome of one `ensureFresh` run. */
export type SyncOutcome =
  | { readonly kind: 'skipped' }
  | { readonly kind: 'upToDate'; readonly meta: InstrumentMasterMeta }
  | { readonly kind: 'updated'; readonly meta: InstrumentMasterMeta; readonly tsv: string }
  | { readonly kind: 'failed'; readonly error: AppError };

/** Dependencies, injected so tests use fakes. */
export type InstrumentSyncDeps = {
  readonly repo: InstrumentMasterRepository;
  readonly kv: KeyValueCache;
  readonly clock: Clock;
  /** Hex SHA-256 of the UTF-8 text (expo-crypto in the app). */
  readonly sha256: (text: string) => Promise<string>;
};

/** The locally stored, verified copy of the master list, or null. */
export type LocalMaster = { readonly meta: InstrumentMasterMeta; readonly tsv: string };

/** Device side of the instrument master sync (LLD §3.6). */
export type InstrumentSyncService = {
  /** Reads the verified local copy (no network). */
  loadLocal(): LocalMaster | null;
  /**
   * Checks for a newer version (≤ once per 24 h unless `force`) and downloads it. Never throws:
   * any failure keeps the previous copy and is reported as `failed`.
   */
  ensureFresh(opts?: { readonly force?: boolean }): Promise<SyncOutcome>;
};

/** Creates the sync service. */
export function createInstrumentSyncService(deps: InstrumentSyncDeps): InstrumentSyncService {
  const { kv } = deps;

  function loadLocal(): LocalMaster | null {
    const meta = kv.get(KV_KEYS.instrumentsMeta, InstrumentMasterMetaSchema);
    const tsv = kv.get(KV_KEYS.instrumentsTsv, z.string());
    return meta && tsv !== null ? { meta, tsv } : null;
  }

  async function ensureFresh(opts: { readonly force?: boolean } = {}): Promise<SyncOutcome> {
    try {
      const local = loadLocal();
      const now = deps.clock.now();
      const lastCheck = kv.get(KV_KEYS.instrumentsLastCheckAt, z.number());
      // 1. Checked recently and have a copy → nothing to do.
      if (!opts.force && local && lastCheck !== null && now - lastCheck < CHECK_INTERVAL_MS) {
        return { kind: 'skipped' };
      }
      // 2. One read for the meta; same version → done.
      const meta = await deps.repo.getMeta();
      if (!meta) throw new AppError('SYNC_FAILED', { context: { reason: 'no meta' } });
      if (local && local.meta.version === meta.version) {
        kv.set(KV_KEYS.instrumentsLastCheckAt, now);
        return { kind: 'upToDate', meta: local.meta };
      }
      // 3. Chunks (≈ 2 reads) → order, version check, concatenate, verify the hash.
      const assembled = assembleChunks(meta, await deps.repo.getChunks(meta));
      if (!assembled.ok) throw new AppError('SYNC_FAILED', { context: { reason: assembled.error } });
      if ((await deps.sha256(assembled.value)) !== meta.sha256) throw new AppError('SYNC_HASH_MISMATCH');
      // 4. MMKV writes each key atomically: TSV first, meta last. A crash in between leaves a
      //    verified TSV with the old meta, so the next check simply downloads again.
      kv.set(KV_KEYS.instrumentsTsv, assembled.value);
      kv.set(KV_KEYS.instrumentsMeta, meta);
      kv.set(KV_KEYS.instrumentsLastCheckAt, now);
      return { kind: 'updated', meta, tsv: assembled.value };
    } catch (e) {
      // 5. Keep the previous copy; retry next launch.
      return { kind: 'failed', error: toAppError(e) };
    }
  }

  return { loadLocal, ensureFresh };
}
