import { useStore } from 'zustand';

import { firebaseAuthService } from '@/services/auth/firebaseAuthService';
import { createProfileRepository } from '@/services/firestore/profileRepository';
import { createSessionStore, type SessionState } from './sessionStore';

/** The app's session store, wired to Firebase. */
export const sessionStore = createSessionStore({
  auth: firebaseAuthService,
  profiles: createProfileRepository,
});

/** React hook selecting from the session store. */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(sessionStore, selector);
}
