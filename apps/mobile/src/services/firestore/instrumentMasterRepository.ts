import {
  AppError,
  InstrumentChunkSchema,
  InstrumentMasterMetaSchema,
  type InstrumentChunk,
  type InstrumentMasterMeta,
  type InstrumentMasterRepository,
} from '@portfolio/core';
import { doc, getDocFromServer, getFirestore } from '@react-native-firebase/firestore';

import { mapFirestoreError } from './errors';

const META_PATH = 'reference/instruments';

/**
 * Read-only `reference/instruments` (LLD §1.8, §3.6). Always reads from the server: the device
 * keeps its own verified copy in MMKV, so a stale Firestore cache must never answer "same
 * version". Offline → `FS_UNAVAILABLE` and the caller keeps the local copy.
 */
export function createInstrumentMasterRepository(): InstrumentMasterRepository {
  const db = getFirestore();
  return {
    async getMeta(): Promise<InstrumentMasterMeta | null> {
      try {
        const snap = await getDocFromServer(doc(db, META_PATH));
        if (!snap.exists()) return null;
        const parsed = InstrumentMasterMetaSchema.safeParse(snap.data());
        if (!parsed.success)
          throw new AppError('FS_INVALID_DOC', { cause: parsed.error, context: { count: 1 } });
        return parsed.data;
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },
    async getChunks(meta: InstrumentMasterMeta): Promise<InstrumentChunk[]> {
      try {
        const snaps = await Promise.all(
          meta.chunkIds.map((id) => getDocFromServer(doc(db, META_PATH, 'chunks', id))),
        );
        return snaps.map((snap) => {
          const parsed = InstrumentChunkSchema.safeParse(snap.exists() ? snap.data() : null);
          if (!parsed.success)
            throw new AppError('FS_INVALID_DOC', { cause: parsed.error, context: { count: 1 } });
          return parsed.data;
        });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },
  };
}
