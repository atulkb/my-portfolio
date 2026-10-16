import {
  BuyTransactionSchema,
  normalisePlatform,
  SCHEMA_VERSION,
  type BuyTransaction,
  type BuyTransactionPatch,
  type NewBuyTransaction,
  type ReadResult,
  type TransactionRepository,
} from '@portfolio/core';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type WriteBatch,
} from '@react-native-firebase/firestore';

import { timestampsToMillis } from './convert';
import { mapFirestoreError } from './errors';

/** Firestore allows 500 operations per batch (LLD §3.7). */
const BATCH_LIMIT = 500;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Parses one document; invalid ones are skipped and counted by the caller (LLD §3.7). */
function parseTx(id: string, data: unknown): BuyTransaction | null {
  const parsed = BuyTransactionSchema.safeParse(timestampsToMillis(data));
  if (!parsed.success) {
    if (__DEV__) console.warn(`transactions/${id} skipped`, parsed.error.issues);
    return null;
  }
  return { ...parsed.data, id };
}

/** `users/{uid}/transactions` repository (LLD §1.10, §3.7). */
export function createTransactionRepository(uid: string): TransactionRepository {
  const db = getFirestore();
  const col = collection(db, 'users', uid, 'transactions');

  async function commitInBatches(
    refs: readonly DocumentReference[],
    op: (batch: WriteBatch, ref: DocumentReference) => void,
  ): Promise<void> {
    // Sequential batches: each is atomic; operations are idempotent, so a retry after a partial
    // failure is safe.
    for (const part of chunks(refs, BATCH_LIMIT)) {
      const batch = writeBatch(db);
      for (const ref of part) op(batch, ref);
      await batch.commit();
    }
  }

  return {
    newIds: (n) => Array.from({ length: n }, () => doc(col).id),

    async listAll(): Promise<ReadResult<BuyTransaction>> {
      try {
        const snap = await getDocs(col);
        const items: BuyTransaction[] = [];
        let skipped = 0;
        for (const d of snap.docs) {
          const tx = parseTx(d.id, d.data({ serverTimestamps: 'estimate' }));
          if (tx) items.push(tx);
          else skipped += 1;
        }
        return { items, skipped };
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async addMany(items, importBatchId) {
      const byRef = new Map<DocumentReference, NewBuyTransaction>();
      for (const { id, tx } of items) byRef.set(doc(col, id), tx);
      try {
        await commitInBatches([...byRef.keys()], (batch, ref) => {
          batch.set(ref, {
            schemaVersion: SCHEMA_VERSION,
            ...byRef.get(ref),
            importBatchId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async deleteByImportBatch(importBatchId) {
      try {
        const snap = await getDocs(query(col, where('importBatchId', '==', importBatchId)));
        await commitInBatches(
          snap.docs.map((d) => d.ref),
          (batch, ref) => batch.delete(ref),
        );
        return snap.docs.length;
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async update(id: string, patch: BuyTransactionPatch) {
      try {
        await updateDoc(doc(col, id), { ...patch, updatedAt: serverTimestamp() });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async deleteMany(ids) {
      try {
        await commitInBatches(
          ids.map((id) => doc(col, id)),
          (batch, ref) => batch.delete(ref),
        );
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async renamePlatform(from, to) {
      // Firestore can't match case-insensitively: read all, filter in memory (≤ 500 docs).
      try {
        const snap = await getDocs(col);
        const target = normalisePlatform(from);
        const refs = snap.docs
          .filter((d) => {
            const p: unknown = d.get('platform');
            return typeof p === 'string' && normalisePlatform(p) === target;
          })
          .map((d) => d.ref);
        await commitInBatches(refs, (batch, ref) =>
          batch.update(ref, { platform: to.trim(), updatedAt: serverTimestamp() }),
        );
        return refs.length;
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },
  };
}
