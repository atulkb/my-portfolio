import * as Crypto from 'expo-crypto';
import { useStore } from 'zustand';

import { localIsoDate } from '@/lib/dates';
import { firebaseAuthService } from '@/services/auth/firebaseAuthService';
import { createKeyValueCache } from '@/services/cache/kv';
import { mmkvRawStore, wipeUserData } from '@/services/cache/storage';
import { createInstrumentMasterRepository } from '@/services/firestore/instrumentMasterRepository';
import { createProfileRepository } from '@/services/firestore/profileRepository';
import { createTransactionRepository } from '@/services/firestore/transactionRepository';
import {
  clearInstrumentIndex,
  getInstrumentIndex,
  setIndexFromTsv,
} from '@/services/instruments/instrumentIndex';
import { createInstrumentSyncService } from '@/services/instruments/instrumentSyncService';
import { createInstrumentStore, type InstrumentState } from './instrumentStore';
import { createPortfolioStore, type PortfolioState } from './portfolioStore';
import { createSessionStore, type SessionState } from './sessionStore';
import { createToastStore, type ToastState } from './toastStore';

const kv = createKeyValueCache(mmkvRawStore());
const clock = { now: () => Date.now() };

/** The app's instrument (stock list) store, wired to Firestore + MMKV. */
export const instrumentStore = createInstrumentStore({
  sync: createInstrumentSyncService({
    // Created on first use so importing the stores never touches Firestore.
    repo: {
      getMeta: () => createInstrumentMasterRepository().getMeta(),
      getChunks: (meta) => createInstrumentMasterRepository().getChunks(meta),
    },
    kv,
    clock,
    sha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
  }),
  getIndex: getInstrumentIndex,
  setIndexFromTsv,
  clearIndex: clearInstrumentIndex,
});

/** Toasts (import results, write failures). */
export const toastStore = createToastStore();

/** The signed-in user's portfolio (buy transactions). */
export const portfolioStore = createPortfolioStore({
  // Resolved per call (the session store is defined below; this only runs after start-up).
  repo: () => {
    const uid = sessionStore.getState().user?.uid;
    return uid ? createTransactionRepository(uid) : null;
  },
  kv,
  clock,
  today: () => localIsoDate(),
  newBatchId: () => Crypto.randomUUID(),
});

/** The app's session store, wired to Firebase. */
export const sessionStore = createSessionStore({
  auth: firebaseAuthService,
  profiles: createProfileRepository,
  onSignedOut: () => {
    wipeUserData();
    instrumentStore.getState().reset();
    portfolioStore.getState().reset();
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

/** React hook selecting from the portfolio store. */
export function usePortfolio<T>(selector: (s: PortfolioState) => T): T {
  return useStore(portfolioStore, selector);
}

/** React hook selecting from the toast store. */
export function useToast<T>(selector: (s: ToastState) => T): T {
  return useStore(toastStore, selector);
}
