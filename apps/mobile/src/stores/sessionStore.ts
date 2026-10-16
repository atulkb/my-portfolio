import { toAppError, type AppErrorCode, type ProfileRepository, type UserProfile } from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { devErrorDetail } from '@/lib/devError';
import type { AuthService, AuthUser, Unsubscribe } from '@/services/auth/types';

/**
 * App gate (LLD §4.2). `locked` (biometric app lock) is added in M9.
 * - booting: waiting for the first auth state
 * - signedOut: show login / sign-up
 * - unverified: email user who has not verified yet (profile not created until verified)
 * - loadingProfile: signed in, creating/loading `users/{uid}`
 * - ready: show the app
 * - profileError: profile could not be loaded (retry offered)
 */
export type Gate = 'booting' | 'signedOut' | 'unverified' | 'loadingProfile' | 'ready' | 'profileError';

/** Session state and actions. Components read this through `useSession` selectors. */
export type SessionState = {
  readonly gate: Gate;
  readonly user: AuthUser | null;
  readonly profile: UserProfile | null;
  /** Last error from a user action (shown inline), cleared on the next action. */
  readonly error: AppErrorCode | null;
  /** Dev builds only: SDK code/message behind `error`, for diagnosing setup problems. */
  readonly errorDetail: string | null;
  readonly busy: boolean;
  start(): Unsubscribe;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  resendVerification(): Promise<void>;
  checkVerified(): Promise<boolean>;
  sendPasswordReset(email: string): Promise<boolean>;
  retryProfile(): Promise<void>;
  signOut(): Promise<void>;
  clearError(): void;
};

/** Dependencies, injected so tests use fakes. */
export type SessionDeps = {
  readonly auth: AuthService;
  readonly profiles: (uid: string) => ProfileRepository;
  /** Local cleanup after an explicit sign-out (LLD §1.12: wipe MMKV except `device.*`). */
  readonly onSignedOut?: () => void;
};

/** Creates the session store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createSessionStore(deps: SessionDeps): StoreApi<SessionState> {
  return createStore<SessionState>()((set, get) => {
    async function enter(user: AuthUser | null): Promise<void> {
      if (!user) {
        set({ gate: 'signedOut', user: null, profile: null });
        return;
      }
      if (user.provider === 'password' && !user.emailVerified) {
        set({ gate: 'unverified', user, profile: null });
        return;
      }
      set({ gate: 'loadingProfile', user });
      try {
        const profile = await deps.profiles(user.uid).createIfMissing({
          displayName: user.displayName ?? user.email.split('@')[0] ?? 'Investor',
          email: user.email,
          authProvider: user.provider,
        });
        if (get().user?.uid === user.uid) set({ gate: 'ready', profile });
      } catch (e) {
        if (get().user?.uid === user.uid) {
          set({ gate: 'profileError', error: toAppError(e).code, errorDetail: devErrorDetail(e) });
        }
      }
    }

    /** Runs a user action with busy/error handling; returns false on failure. */
    async function act(fn: () => Promise<void>): Promise<boolean> {
      set({ busy: true, error: null, errorDetail: null });
      try {
        await fn();
        return true;
      } catch (e) {
        const code = toAppError(e).code;
        set({ error: code === 'AUTH_GOOGLE_CANCELLED' ? null : code, errorDetail: devErrorDetail(e) });
        return false;
      } finally {
        set({ busy: false });
      }
    }

    return {
      gate: 'booting',
      user: null,
      profile: null,
      error: null,
      errorDetail: null,
      busy: false,

      start: () => deps.auth.onAuthStateChanged((u) => void enter(u)),

      signInWithGoogle: async () => {
        await act(async () => {
          await deps.auth.signInWithGoogle();
        });
      },
      signInWithEmail: async (email, password) => {
        await act(async () => {
          await deps.auth.signInWithEmail(email, password);
        });
      },
      signUp: async (name, email, password) => {
        await act(async () => {
          const user = await deps.auth.signUpWithEmail(name, email, password);
          await enter(user);
        });
      },
      resendVerification: async () => {
        await act(() => deps.auth.sendVerificationEmail());
      },
      checkVerified: async () => {
        let verified = false;
        await act(async () => {
          const user = await deps.auth.reloadUser();
          verified = user?.emailVerified ?? false;
          if (verified) await enter(user);
          else set({ error: 'AUTH_NOT_VERIFIED' });
        });
        return verified;
      },
      sendPasswordReset: (email) => act(() => deps.auth.sendPasswordReset(email)),
      retryProfile: () => enter(get().user),
      signOut: async () => {
        await act(async () => {
          await deps.auth.signOut();
          deps.onSignedOut?.();
        });
      },
      clearError: () => set({ error: null, errorDetail: null }),
    };
  });
}
