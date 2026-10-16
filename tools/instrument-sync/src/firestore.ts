import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import type { InstrumentChunk, InstrumentMasterMeta } from '@portfolio/core';

import type { MasterStore } from './upload';

const META_PATH = 'reference/instruments';
const CHUNKS_PATH = `${META_PATH}/chunks`;

/** Shown when Application Default Credentials are missing or expired. */
export const ADC_HELP =
  'No Google credentials found. Run:\n  gcloud auth application-default login\n' +
  'with the account that owns the Firebase project, then try again.';

/** True for the Admin SDK / google-auth "no credentials" family of errors. */
export function isCredentialError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /default credentials|invalid_grant|reauth|Could not refresh access token|UNAUTHENTICATED/i.test(msg);
}

/**
 * Firestore master-list store on the Admin SDK with Application Default Credentials (the
 * developer's own gcloud login, LLD §3.6). No key file. Admin SDK bypasses security rules.
 */
export function createAdminStore(projectId: string): MasterStore {
  const app = initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore(app);
  return {
    async getMeta() {
      const snap = await db.doc(META_PATH).get();
      return snap.exists ? snap.data() : null;
    },
    async listChunkIds() {
      const refs = await db.collection(CHUNKS_PATH).listDocuments();
      return refs.map((r) => r.id);
    },
    async writeChunk(id: string, chunk: InstrumentChunk) {
      await db.collection(CHUNKS_PATH).doc(id).set(chunk);
    },
    async writeMeta(meta: InstrumentMasterMeta) {
      await db.doc(META_PATH).set(meta);
    },
    async deleteChunks(ids: readonly string[]) {
      const batch = db.batch();
      for (const id of ids) batch.delete(db.collection(CHUNKS_PATH).doc(id));
      await batch.commit();
    },
  };
}
