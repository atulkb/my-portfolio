import { z } from 'zod';

import { createKeyValueCache, memoryRawStore } from '@/services/cache/kv';
import { THEME_KEY, createThemeStore, nativeColorScheme } from './themeStore';

describe('themeStore', () => {
  it('defaults to system', () => {
    expect(createThemeStore(createKeyValueCache(memoryRawStore())).getState().preference).toBe('system');
  });

  it('persists the choice and restores it', () => {
    const kv = createKeyValueCache(memoryRawStore());
    createThemeStore(kv).getState().setPreference('light');
    expect(kv.get(THEME_KEY, z.string())).toBe('light');
    expect(createThemeStore(kv).getState().preference).toBe('light');
  });

  it('falls back to system for an invalid stored value', () => {
    const kv = createKeyValueCache(memoryRawStore());
    kv.set(THEME_KEY, 'sepia');
    expect(createThemeStore(kv).getState().preference).toBe('system');
  });

  it('reset forgets the choice', () => {
    const kv = createKeyValueCache(memoryRawStore());
    const store = createThemeStore(kv);
    store.getState().setPreference('dark');
    store.getState().reset();
    expect(store.getState().preference).toBe('system');
    expect(kv.get(THEME_KEY, z.string())).toBeNull();
  });

  it('maps the preference to the native colour scheme', () => {
    expect(nativeColorScheme('system')).toBe('unspecified');
    expect(nativeColorScheme('light')).toBe('light');
    expect(nativeColorScheme('dark')).toBe('dark');
  });
});
