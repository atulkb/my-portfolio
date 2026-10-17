import { AppError } from '@portfolio/core';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from '@react-native-firebase/auth';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';

import { ENV } from '@/config/env';
import { mapAuthError } from './errors';
import type { AuthService, AuthUser } from './types';

function toAuthUser(u: User): AuthUser {
  const google = u.providerData.some((p) => p.providerId === 'google.com');
  return {
    uid: u.uid,
    email: u.email ?? '',
    displayName: u.displayName,
    emailVerified: u.emailVerified,
    provider: google ? 'google' : 'password',
  };
}

let googleConfigured = false;

function configureGoogle(): void {
  if (googleConfigured) return;
  if (!ENV.googleWebClientId) throw new AppError('AUTH_GOOGLE_CONFIG');
  GoogleSignin.configure({ webClientId: ENV.googleWebClientId });
  googleConfigured = true;
}

/** Google sign-in → Firebase credential (sign-in and re-authentication). */
async function googleCredential() {
  configureGoogle();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res)) throw new AppError('AUTH_GOOGLE_CANCELLED');
  const idToken = res.data.idToken;
  if (!idToken) throw new AppError('AUTH_GOOGLE_CONFIG');
  return GoogleAuthProvider.credential(idToken);
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapAuthError(e);
  }
}

/** Firebase Auth + Google Sign-In implementation of {@link AuthService}. The only file importing these SDKs. */
export const firebaseAuthService: AuthService = {
  onAuthStateChanged(cb) {
    return onAuthStateChanged(getAuth(), (u) => cb(u ? toAuthUser(u) : null));
  },

  signInWithGoogle: () =>
    guard(async () => {
      const cred = await signInWithCredential(getAuth(), await googleCredential());
      return toAuthUser(cred.user);
    }),

  signUpWithEmail: (name, email, password) =>
    guard(async () => {
      const cred = await createUserWithEmailAndPassword(getAuth(), email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await sendEmailVerification(cred.user);
      await reload(cred.user);
      return toAuthUser(getAuth().currentUser ?? cred.user);
    }),

  signInWithEmail: (email, password) =>
    guard(async () => toAuthUser((await signInWithEmailAndPassword(getAuth(), email.trim(), password)).user)),

  sendVerificationEmail: () =>
    guard(async () => {
      const u = getAuth().currentUser;
      if (u) await sendEmailVerification(u);
    }),

  reloadUser: () =>
    guard(async () => {
      const u = getAuth().currentUser;
      if (!u) return null;
      await reload(u);
      const fresh = getAuth().currentUser;
      return fresh ? toAuthUser(fresh) : null;
    }),

  sendPasswordReset: (email) => guard(() => sendPasswordResetEmail(getAuth(), email.trim())),

  reauthenticate: (password) =>
    guard(async () => {
      const u = getAuth().currentUser;
      if (!u) throw new AppError('AUTH_RECENT_LOGIN');
      const google = u.providerData.some((p) => p.providerId === 'google.com');
      const cred = google
        ? await googleCredential()
        : EmailAuthProvider.credential(u.email ?? '', password ?? '');
      await reauthenticateWithCredential(u, cred);
    }),

  deleteUser: () =>
    guard(async () => {
      const u = getAuth().currentUser;
      if (!u) return;
      await deleteUser(u);
      if (googleConfigured) await GoogleSignin.signOut().catch(() => undefined);
    }),

  signOut: () =>
    guard(async () => {
      if (googleConfigured) await GoogleSignin.signOut().catch(() => undefined);
      await signOut(getAuth());
    }),
};
