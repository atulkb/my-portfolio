import {
  AppError,
  DEFAULT_WATCHLIST_NAME,
  type ProfileSeed,
  SCHEMA_VERSION,
  UserProfileSchema,
  UserSettingsSchema,
  type InstrumentKey,
  type ProfileRepository,
  type UserProfile,
} from '@portfolio/core';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from '@react-native-firebase/firestore';

import { timestampsToMillis } from './convert';
import { mapFirestoreError } from './errors';

function parseProfile(data: unknown): UserProfile {
  const parsed = UserProfileSchema.safeParse(timestampsToMillis(data));
  if (!parsed.success) throw new AppError('FS_INVALID_DOC', { cause: parsed.error, context: { count: 1 } });
  return parsed.data;
}

/**
 * `users/{uid}` repository (LLD §1.10). Account deletion is implemented with the other
 * repositories in M9 (it needs every collection).
 */
export function createProfileRepository(uid: string): ProfileRepository {
  const db = getFirestore();
  const ref = doc(db, 'users', uid);

  return {
    async get() {
      try {
        const snap = await getDoc(ref);
        return snap.exists() ? parseProfile(snap.data({ serverTimestamps: 'estimate' })) : null;
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async createIfMissing(seed: ProfileSeed) {
      try {
        // Idempotent: creates the profile and "My Watchlist" only if the profile is absent (LLD §1.12).
        await runTransaction(db, async (tx) => {
          const existing = await tx.get(ref);
          if (existing.exists()) return;
          tx.set(ref, {
            schemaVersion: SCHEMA_VERSION,
            displayName: seed.displayName.trim().slice(0, 80) || 'Investor',
            email: seed.email,
            authProvider: seed.authProvider,
            settings: UserSettingsSchema.parse({}),
            platforms: [],
            sectorOverrides: {},
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(collection(db, 'users', uid, 'watchlists')), {
            schemaVersion: SCHEMA_VERSION,
            name: DEFAULT_WATCHLIST_NAME,
            sortOrder: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        const snap = await getDoc(ref);
        return parseProfile(snap.data({ serverTimestamps: 'estimate' }));
      } catch (e) {
        throw mapFirestoreError(e);
      }
    },

    async updateSettings(patch) {
      const fields: Record<string, unknown> = { updatedAt: serverTimestamp() };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) fields[`settings.${k}`] = v;
      await updateDoc(ref, fields).catch((e: unknown) => {
        throw mapFirestoreError(e);
      });
    },

    async setPlatforms(platforms) {
      await updateDoc(ref, { platforms, updatedAt: serverTimestamp() }).catch((e: unknown) => {
        throw mapFirestoreError(e);
      });
    },

    async setSectorOverride(key: InstrumentKey, sector: string | null) {
      const value = sector === null ? deleteField() : sector.trim().slice(0, 60);
      await updateDoc(ref, { [`sectorOverrides.${key}`]: value, updatedAt: serverTimestamp() }).catch(
        (e: unknown) => {
          throw mapFirestoreError(e);
        },
      );
    },

    async deleteAccountData() {
      throw new AppError('APP_UNEXPECTED', { context: { reason: 'Account deletion arrives in M9' } });
    },
  };
}
