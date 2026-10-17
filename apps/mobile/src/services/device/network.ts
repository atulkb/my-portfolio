import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

/** `null` until the first NetInfo report; treated as online so nothing is blocked at start. */
let connected: boolean | null = null;
const listeners = new Set<() => void>();
let started = false;

function start(): void {
  if (started) return;
  started = true;
  NetInfo.addEventListener((s) => {
    // `isInternetReachable` is null while unknown: fall back to `isConnected`.
    const next = s.isConnected === false ? false : s.isInternetReachable !== false;
    if (next === connected) return;
    connected = next;
    listeners.forEach((l) => l());
  });
}

/** Last known connectivity (LLD §4.6); true while unknown. */
export function isOnline(): boolean {
  start();
  return connected !== false;
}

/** Subscribes to connectivity changes; returns the unsubscribe function. */
export function subscribeOnline(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: true unless the device is known to be offline. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline);
}
