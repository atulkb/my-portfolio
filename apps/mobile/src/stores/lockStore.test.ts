import { z } from 'zod';

import { createKeyValueCache, memoryRawStore } from '@/services/cache/kv';
import { BIOMETRIC_LOCK_KEY, createLockStore } from './lockStore';

function setup(opts: { enabled?: boolean; available?: boolean; pass?: boolean } = {}) {
  const kv = createKeyValueCache(memoryRawStore());
  if (opts.enabled) kv.set(BIOMETRIC_LOCK_KEY, true);
  let now = 0;
  const biometrics = {
    available: jest.fn(async () => opts.available ?? true),
    authenticate: jest.fn(async () => opts.pass ?? true),
  };
  const store = createLockStore({ kv, biometrics, now: () => now, lockAfterMs: 5 * 60_000 });
  return { store, kv, biometrics, advance: (ms: number) => (now += ms) };
}

describe('lockStore', () => {
  it('starts locked on a cold start when the lock is on', () => {
    expect(setup({ enabled: true }).store.getState().locked).toBe(true);
    expect(setup().store.getState().locked).toBe(false);
  });

  it('needs a successful prompt to turn on, and remembers it per device', async () => {
    const { store, kv } = setup();
    expect(await store.getState().setEnabled(true)).toBe(true);
    expect(store.getState().enabled).toBe(true);
    expect(kv.get(BIOMETRIC_LOCK_KEY, z.boolean())).toBe(true);

    const failed = setup({ pass: false });
    expect(await failed.store.getState().setEnabled(true)).toBe(false);
    expect(failed.store.getState().enabled).toBe(false);
  });

  it('reports devices without enrolled biometrics', async () => {
    const { store, biometrics } = setup({ available: false });
    await store.getState().setEnabled(true);
    expect(store.getState().error).toBe('DEVICE_BIOMETRIC_UNAVAILABLE');
    expect(biometrics.authenticate).not.toHaveBeenCalled();
  });

  it('turns off without a prompt', async () => {
    const { store, biometrics } = setup({ enabled: true });
    await store.getState().setEnabled(false);
    expect(store.getState()).toMatchObject({ enabled: false, locked: false });
    expect(biometrics.authenticate).not.toHaveBeenCalled();
  });

  it('re-locks only after 5 minutes in the background', async () => {
    const { store, advance } = setup({ enabled: true });
    await store.getState().unlock();
    expect(store.getState().locked).toBe(false);

    store.getState().onAppState('background');
    advance(4 * 60_000);
    store.getState().onAppState('active');
    expect(store.getState().locked).toBe(false);

    store.getState().onAppState('background');
    advance(5 * 60_000);
    store.getState().onAppState('active');
    expect(store.getState().locked).toBe(true);
  });

  it('stays locked when the prompt fails', async () => {
    const { store } = setup({ enabled: true, pass: false });
    expect(await store.getState().unlock()).toBe(false);
    expect(store.getState().locked).toBe(true);
  });
});
