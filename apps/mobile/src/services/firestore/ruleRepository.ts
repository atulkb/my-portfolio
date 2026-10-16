import {
  ruleResultId,
  RuleResultSchema,
  RuleSchema,
  SCHEMA_VERSION,
  type ReadResult,
  type Rule,
  type RuleRepository,
  type RuleResult,
} from '@portfolio/core';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';

import { timestampsToMillis } from './convert';
import { mapFirestoreError } from './errors';

/** Firestore allows 500 operations per batch (LLD §3.7). */
const BATCH_LIMIT = 500;

/** `users/{uid}/rules` and `ruleResults` (LLD §1.7, §1.10). */
export function createRuleRepository(uid: string): RuleRepository {
  const db = getFirestore();
  const rules = collection(db, 'users', uid, 'rules');
  const results = collection(db, 'users', uid, 'ruleResults');

  return {
    newId: () => doc(rules).id,

    async list(): Promise<ReadResult<Rule>> {
      try {
        const snap = await getDocs(rules);
        const items: Rule[] = [];
        let skipped = 0;
        for (const d of snap.docs) {
          const parsed = RuleSchema.safeParse(timestampsToMillis(d.data({ serverTimestamps: 'estimate' })));
          if (parsed.success) items.push({ ...parsed.data, id: d.id });
          else {
            skipped += 1;
            if (__DEV__) console.warn(`rules/${d.id} skipped`, parsed.error.issues);
          }
        }
        return { items, skipped };
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async create(id, rule) {
      try {
        await setDoc(doc(rules, id), {
          schemaVersion: SCHEMA_VERSION,
          ...rule,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async update(id, patch) {
      try {
        await updateDoc(doc(rules, id), { ...patch, updatedAt: serverTimestamp() });
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async delete(id) {
      try {
        await deleteDoc(doc(rules, id));
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async saveResults(list: RuleResult[]) {
      try {
        for (let i = 0; i < list.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          for (const r of list.slice(i, i + BATCH_LIMIT))
            batch.set(doc(results, ruleResultId(r.sessionDate, r.ruleId)), r);
          await batch.commit();
        }
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async listResults(sessionDate) {
      try {
        const snap = await getDocs(query(results, where('sessionDate', '==', sessionDate)));
        const items: RuleResult[] = [];
        let skipped = 0;
        for (const d of snap.docs) {
          const parsed = RuleResultSchema.safeParse(d.data());
          if (parsed.success) items.push(parsed.data);
          else skipped += 1;
        }
        return { items, skipped };
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async pruneResultsBefore(date) {
      try {
        const snap = await getDocs(query(results, where('sessionDate', '<', date)));
        for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
          const batch = writeBatch(db);
          for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
          await batch.commit();
        }
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },
  };
}
