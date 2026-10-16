import type { KeyValueCache } from '@portfolio/core';
import type { z } from 'zod';

/** The few string operations the cache needs (MMKV in the app, a Map in tests). */
export interface RawStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  getAllKeys(): string[];
}

/**
 * JSON key-value cache over a {@link RawStore}. Every read is validated with the caller's zod
 * schema; unparsable or old-shape values are deleted and read as missing (LLD §3.1).
 */
export function createKeyValueCache(raw: RawStore): KeyValueCache {
  return {
    get<T>(key: string, schema: z.ZodType<T>): T | null {
      const text = raw.getString(key);
      if (text === undefined) return null;
      try {
        const parsed = schema.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
      } catch {
        // fall through: corrupt JSON is treated like an invalid value
      }
      raw.remove(key);
      return null;
    },
    set<T>(key: string, value: T): void {
      raw.set(key, JSON.stringify(value));
    },
    delete(key: string): void {
      raw.remove(key);
    },
    keys(prefix: string): string[] {
      return raw.getAllKeys().filter((k) => k.startsWith(prefix));
    },
  };
}

/** In-memory {@link RawStore} for tests. */
export function memoryRawStore(initial: Record<string, string> = {}): RawStore & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getString: (k) => data.get(k),
    set: (k, v) => {
      data.set(k, v);
    },
    remove: (k) => {
      data.delete(k);
    },
    getAllKeys: () => [...data.keys()],
  };
}
