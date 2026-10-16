import {
  SCHEMA_VERSION,
  toInstrumentKey,
  WatchlistItemSchema,
  WatchlistSchema,
  type ReadResult,
  type Watchlist,
  type WatchlistItem,
  type WatchlistRepository,
} from '@portfolio/core';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
} from '@react-native-firebase/firestore';
import type { z } from 'zod';

import { timestampsToMillis } from './convert';
import { mapFirestoreError } from './errors';

function parseAll<S extends z.ZodTypeAny, T>(
  docs: readonly { id: string; data: (o: { serverTimestamps: 'estimate' }) => unknown }[],
  schema: S,
  shape: (id: string, value: z.infer<S>) => T,
  path: string,
): ReadResult<T> {
  const items: T[] = [];
  let skipped = 0;
  for (const d of docs) {
    const parsed = schema.safeParse(timestampsToMillis(d.data({ serverTimestamps: 'estimate' })));
    if (parsed.success) items.push(shape(d.id, parsed.data));
    else {
      skipped += 1;
      if (__DEV__) console.warn(`${path}/${d.id} skipped`, parsed.error.issues);
    }
  }
  return { items, skipped };
}

/**
 * `users/{uid}/watchlists` and `.../items/{instrumentKey}` (LLD §1.6, §1.10). Limits and name
 * uniqueness are checked by the store before writing.
 */
export function createWatchlistRepository(uid: string): WatchlistRepository {
  const db = getFirestore();
  const lists = collection(db, 'users', uid, 'watchlists');
  const items = (listId: string) => collection(db, 'users', uid, 'watchlists', listId, 'items');

  return {
    async listWatchlists() {
      try {
        const snap = await getDocs(lists);
        return parseAll(snap.docs, WatchlistSchema, (id, w): Watchlist => ({ ...w, id }), 'watchlists');
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    newListId: () => doc(lists).id,

    async createWatchlist(id, name, sortOrder) {
      try {
        await setDoc(doc(lists, id), {
          schemaVersion: SCHEMA_VERSION,
          name: name.trim(),
          sortOrder,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async renameWatchlist(id, name) {
      try {
        await updateDoc(doc(lists, id), { name: name.trim(), updatedAt: serverTimestamp() });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async deleteWatchlist(id) {
      try {
        // Items and the list in one batch (≤ 100 items, well under the 500-operation limit).
        const snap = await getDocs(items(id));
        const batch = writeBatch(db);
        for (const d of snap.docs) batch.delete(d.ref);
        batch.delete(doc(lists, id));
        await batch.commit();
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async listItems(watchlistId) {
      try {
        const snap = await getDocs(items(watchlistId));
        return parseAll(snap.docs, WatchlistItemSchema, (_id, i): WatchlistItem => i, 'items');
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async upsertItem(watchlistId, item, opts) {
      const ref = doc(items(watchlistId), toInstrumentKey(item.exchange, item.symbol));
      try {
        if (opts?.exists) await updateDoc(ref, { ...item, updatedAt: serverTimestamp() });
        else
          await setDoc(ref, {
            schemaVersion: SCHEMA_VERSION,
            ...item,
            addedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async removeItem(watchlistId, key) {
      try {
        await deleteDoc(doc(items(watchlistId), key));
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },
  };
}
