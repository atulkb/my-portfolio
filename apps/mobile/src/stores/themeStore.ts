import type { KeyValueCache } from '@portfolio/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** MMKV key of the appearance preference (LLD §4.17): `device.*` survives sign-out. */
export const THEME_KEY = 'device.theme';

/** Settings → Appearance choices (LLD §4.17). */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
/** `system` follows the phone's dark-mode setting. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
const ThemePreferenceSchema = z.enum(THEME_PREFERENCES);

/** Appearance preference, stored on this device only (LLD §4.17). */
export type ThemeState = {
  readonly preference: ThemePreference;
  setPreference(preference: ThemePreference): void;
  /** "Clear local cache": forgets the choice, back to `system`. */
  reset(): void;
};

/** Creates the theme store, restoring the saved preference (invalid or missing → `system`). */
export function createThemeStore(kv: KeyValueCache): StoreApi<ThemeState> {
  return createStore<ThemeState>()((set) => ({
    preference: kv.get(THEME_KEY, ThemePreferenceSchema) ?? 'system',
    setPreference: (preference) => {
      set({ preference });
      kv.set(THEME_KEY, preference);
    },
    reset: () => {
      set({ preference: 'system' });
      kv.delete(THEME_KEY);
    },
  }));
}

/** The value for `Appearance.setColorScheme`: `system` hands the choice back to the phone. */
export function nativeColorScheme(preference: ThemePreference): 'light' | 'dark' | 'unspecified' {
  return preference === 'system' ? 'unspecified' : preference;
}
