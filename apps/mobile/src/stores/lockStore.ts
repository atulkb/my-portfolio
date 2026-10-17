import type { AppErrorCode, KeyValueCache } from '@portfolio/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Biometrics } from '@/services/device/biometrics';

/** Device-local setting (survives sign-out, LLD §1.9). */
export const BIOMETRIC_LOCK_KEY = 'device.biometricLock';

/** Biometric app lock (LLD §4.2 `locked` gate). */
export type LockState = {
  readonly enabled: boolean;
  /** True while the lock screen must cover the app. */
  readonly locked: boolean;
  readonly error: AppErrorCode | null;
  /** Enabling needs one successful prompt; disabling does not. Returns the new value. */
  setEnabled(enabled: boolean): Promise<boolean>;
  /** Shows the prompt; unlocks on success. */
  unlock(): Promise<boolean>;
  /** Tracks foreground/background to re-lock after `lockAfterMs` in the background. */
  onAppState(state: 'active' | 'background' | 'inactive' | 'unknown' | 'extension'): void;
  /** Sign-out from the lock screen: nothing to protect any more. */
  release(): void;
};

/** Dependencies, injected so tests use fakes. */
export type LockDeps = {
  readonly kv: KeyValueCache;
  readonly biometrics: Biometrics;
  readonly now: () => number;
  readonly lockAfterMs: number;
};

/** Creates the lock store; a cold start is locked when the lock is on. */
export function createLockStore(deps: LockDeps): StoreApi<LockState> {
  const enabled = deps.kv.get(BIOMETRIC_LOCK_KEY, z.boolean()) ?? false;
  let backgroundAt: number | null = null;
  let prompting = false;

  return createStore<LockState>()((set, get) => ({
    enabled,
    locked: enabled,
    error: null,

    setEnabled: async (on) => {
      if (!on) {
        deps.kv.set(BIOMETRIC_LOCK_KEY, false);
        set({ enabled: false, locked: false, error: null });
        return false;
      }
      if (!(await deps.biometrics.available())) {
        set({ error: 'DEVICE_BIOMETRIC_UNAVAILABLE' });
        return false;
      }
      prompting = true;
      const ok = await deps.biometrics.authenticate('Confirm to turn on app lock').finally(() => {
        prompting = false;
      });
      if (!ok) return false;
      deps.kv.set(BIOMETRIC_LOCK_KEY, true);
      set({ enabled: true, error: null });
      return true;
    },

    unlock: async () => {
      if (prompting) return false;
      prompting = true;
      try {
        const ok = await deps.biometrics.authenticate('Unlock Portfolio Analyzer');
        if (ok) set({ locked: false });
        return ok;
      } finally {
        prompting = false;
      }
    },

    onAppState: (state) => {
      // The system prompt itself sends the app to `inactive`/`background`: ignore those.
      if (prompting) return;
      if (state === 'background') backgroundAt = deps.now();
      else if (state === 'active') {
        const away = backgroundAt === null ? 0 : deps.now() - backgroundAt;
        backgroundAt = null;
        if (get().enabled && away >= deps.lockAfterMs) set({ locked: true });
      }
    },

    release: () => set({ locked: false }),
  }));
}
