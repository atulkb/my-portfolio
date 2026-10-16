import { AppError, type ProfileRepository, type UserProfile } from '@portfolio/core';

import type { AuthService, AuthUser } from '@/services/auth/types';
import { createSessionStore } from './sessionStore';

const profile: UserProfile = {
  schemaVersion: 1,
  displayName: 'Alice',
  email: 'alice@example.com',
  authProvider: 'google',
  settings: { summaryCurrency: 'INR', defaultSort: 'VALUE_DESC', aiSuggestions: true },
  platforms: [],
  sectorOverrides: {},
  createdAt: 1,
  updatedAt: 1,
};

const googleUser: AuthUser = {
  uid: 'u1',
  email: 'alice@example.com',
  displayName: 'Alice',
  emailVerified: true,
  provider: 'google',
};
const unverified: AuthUser = { ...googleUser, uid: 'u2', provider: 'password', emailVerified: false };

function setup(overrides: Partial<AuthService> = {}, repo: Partial<ProfileRepository> = {}) {
  let listener: (u: AuthUser | null) => void = () => undefined;
  const createIfMissing = jest.fn(async () => profile);
  const auth: AuthService = {
    onAuthStateChanged: (cb) => {
      listener = cb;
      return () => undefined;
    },
    signInWithGoogle: jest.fn(async () => googleUser),
    signUpWithEmail: jest.fn(async () => unverified),
    signInWithEmail: jest.fn(async () => googleUser),
    sendVerificationEmail: jest.fn(async () => undefined),
    reloadUser: jest.fn(async () => ({ ...unverified, emailVerified: true })),
    sendPasswordReset: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
    ...overrides,
  };
  const store = createSessionStore({
    auth,
    profiles: () => ({ createIfMissing, ...repo }) as unknown as ProfileRepository,
  });
  store.getState().start();
  const emit = async (u: AuthUser | null): Promise<void> => {
    listener(u);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { store, auth, emit, createIfMissing };
}

describe('session gate', () => {
  it('starts booting, then shows sign-in when signed out', async () => {
    const { store, emit } = setup();
    expect(store.getState().gate).toBe('booting');
    await emit(null);
    expect(store.getState().gate).toBe('signedOut');
  });

  it('creates the profile and becomes ready for a Google user', async () => {
    const { store, emit, createIfMissing } = setup();
    await emit(googleUser);
    expect(createIfMissing).toHaveBeenCalledWith({
      displayName: 'Alice',
      email: 'alice@example.com',
      authProvider: 'google',
    });
    expect(store.getState().gate).toBe('ready');
    expect(store.getState().profile?.displayName).toBe('Alice');
  });

  it('keeps unverified email users out and creates no profile', async () => {
    const { store, emit, createIfMissing } = setup();
    await emit(unverified);
    expect(store.getState().gate).toBe('unverified');
    expect(createIfMissing).not.toHaveBeenCalled();
  });

  it('enters the app once the email is verified', async () => {
    const { store, emit } = setup();
    await emit(unverified);
    await expect(store.getState().checkVerified()).resolves.toBe(true);
    expect(store.getState().gate).toBe('ready');
  });

  it('reports not-verified when the user has not clicked the link', async () => {
    const { store, emit } = setup({ reloadUser: jest.fn(async () => unverified) });
    await emit(unverified);
    await expect(store.getState().checkVerified()).resolves.toBe(false);
    expect(store.getState().gate).toBe('unverified');
    expect(store.getState().error).toBe('AUTH_NOT_VERIFIED');
  });

  it('shows a retryable profile error', async () => {
    const createIfMissing = jest
      .fn()
      .mockRejectedValueOnce(new AppError('FS_UNAVAILABLE'))
      .mockResolvedValueOnce(profile);
    const { store, emit } = setup({}, { createIfMissing });
    await emit(googleUser);
    expect(store.getState().gate).toBe('profileError');
    expect(store.getState().error).toBe('FS_UNAVAILABLE');
    await store.getState().retryProfile();
    expect(store.getState().gate).toBe('ready');
  });
});

describe('session actions', () => {
  it('maps sign-in failures to an inline error and clears busy', async () => {
    const { store } = setup({
      signInWithEmail: jest.fn(async () => Promise.reject(new AppError('AUTH_WRONG_PASSWORD'))),
    });
    await store.getState().signInWithEmail('a@b.c', 'x');
    expect(store.getState().error).toBe('AUTH_WRONG_PASSWORD');
    expect(store.getState().busy).toBe(false);
  });

  it('treats a cancelled Google sign-in as silent', async () => {
    const { store } = setup({
      signInWithGoogle: jest.fn(async () => Promise.reject(new AppError('AUTH_GOOGLE_CANCELLED'))),
    });
    await store.getState().signInWithGoogle();
    expect(store.getState().error).toBeNull();
  });

  it('moves a new email account to the verify screen', async () => {
    const { store } = setup();
    await store.getState().signUp('Alice', 'alice@example.com', 'Secret#123');
    expect(store.getState().gate).toBe('unverified');
  });

  it('reports password reset success', async () => {
    const { store } = setup();
    await expect(store.getState().sendPasswordReset('a@b.c')).resolves.toBe(true);
  });
});
