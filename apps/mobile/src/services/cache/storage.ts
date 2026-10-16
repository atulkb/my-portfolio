import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, deleteMMKV, type MMKV } from 'react-native-mmkv';

import type { RawStore } from './kv';

const MMKV_ID = 'portfolio';
const KEY_NAME = 'mmkv.encryptionKey';
/** AES-256 in MMKV takes a key string of at most 32 bytes (LLD §1.9). */
const KEY_LENGTH = 32;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 32 characters from a 64-symbol alphabet = 192 random bits from the OS CSPRNG. */
function newKey(): string {
  const bytes = Crypto.getRandomBytes(KEY_LENGTH);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function loadOrCreateKey(): string {
  const existing = SecureStore.getItem(KEY_NAME);
  if (existing && existing.length === KEY_LENGTH) return existing;
  const key = newKey();
  SecureStore.setItem(KEY_NAME, key);
  return key;
}

function open(): MMKV {
  return createMMKV({ id: MMKV_ID, encryptionKey: loadOrCreateKey(), encryptionType: 'AES-256' });
}

let instance: MMKV | null = null;
/** Set when the store could not be opened and was reset (surfaced once as DEVICE_STORAGE). */
let wasReset = false;

/**
 * The app's encrypted MMKV store, opened on first use. The key lives in `expo-secure-store`
 * (Android Keystore). If the store can't be opened (e.g. key lost after a restore), it is
 * deleted and recreated empty: everything in it is a re-fetchable cache.
 */
export function storage(): MMKV {
  if (instance) return instance;
  try {
    instance = open();
  } catch {
    deleteMMKV(MMKV_ID);
    SecureStore.setItem(KEY_NAME, newKey());
    instance = open();
    wasReset = true;
  }
  return instance;
}

/** True once if the store had to be reset; the caller shows the DEVICE_STORAGE toast. */
export function takeStorageResetFlag(): boolean {
  const r = wasReset;
  wasReset = false;
  return r;
}

/** MMKV as the minimal {@link RawStore} the key-value cache needs. */
export function mmkvRawStore(): RawStore {
  return {
    getString: (k) => storage().getString(k),
    set: (k, v) => storage().set(k, v),
    remove: (k) => {
      storage().remove(k);
    },
    getAllKeys: () => storage().getAllKeys(),
  };
}

/**
 * Sign-out cleanup (LLD §1.12): removes every key except `device.*` and re-encrypts the store
 * with a fresh key, so nothing of the previous user is readable with the old key.
 */
export function wipeUserData(): void {
  const s = storage();
  for (const k of s.getAllKeys()) if (!k.startsWith('device.')) s.remove(k);
  const key = newKey();
  s.recrypt(key);
  SecureStore.setItem(KEY_NAME, key);
}
