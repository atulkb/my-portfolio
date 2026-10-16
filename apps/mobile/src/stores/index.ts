import * as Crypto from 'expo-crypto';
import { useStore } from 'zustand';

import { firebaseAuthService } from '@/services/auth/firebaseAuthService';
import { createKeyValueCache } from '@/services/cache/kv';
import { mmkvRawStore, wipeUserData } from '@/services/cache/storage';
import { createInstrumentMasterRepository } from '@/services/firestore/instrumentMasterRepository';
import { createProfileRepository } from '@/services/firestore/profileRepository';
import {
  clearInstrumentIndex,
  getInstrumentIndex,
  setIndexFromTsv,
} from '@/services/instruments/instrumentIndex';
import { createInstrumentSyncService } from '@/services/instruments/instrumentSyncService';
import { createInstrumentStore, type InstrumentState } from './instrumentStore';
import { createSessionStore, type SessionState } from './sessionStore';

const kv = createKeyValueCache(mmkvRawStore());

/** The app's instrument (stock list) store, wired to Firestore + MMKV. */
export const instrumentStore = createInstrumentStore({
  sync: createInstrumentSyncService({
    // Created on first use so importing the stores never touches Firestore.
    repo: {
      getMeta: () => createInstrumentMasterRepository().getMeta(),
      getChunks: (meta) => createInstrumentMasterRepository().getChunks(meta),
    },
    kv,
    clock: { now: () => Date.now() },
    sha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
  }),
  getIndex: getInstrumentIndex,
  setIndexFromTsv,
  clearIndex: clearInstrumentIndex,
});

/** The app's session store, wired to Firebase. */
export const sessionStore = createSessionStore({
  auth: firebaseAuthService,
  profiles: createProfileRepository,
  onSignedOut: () => {
    wipeUserData();
    instrumentStore.getState().reset();
  },
});

/** React hook selecting from the session store. */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(sessionStore, selector);
}

/** React hook selecting from the instrument store. */
export function useInstruments<T>(selector: (s: InstrumentState) => T): T {
  return useStore(instrumentStore, selector);
}
