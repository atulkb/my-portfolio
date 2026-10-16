import { AppError, isAppError, type AppErrorCode } from '@portfolio/core';

const FIREBASE_AUTH_CODES: Readonly<Record<string, AppErrorCode>> = {
  'auth/invalid-credential': 'AUTH_WRONG_PASSWORD',
  'auth/wrong-password': 'AUTH_WRONG_PASSWORD',
  'auth/user-not-found': 'AUTH_WRONG_PASSWORD',
  'auth/invalid-email': 'AUTH_WRONG_PASSWORD',
  'auth/email-already-in-use': 'AUTH_EMAIL_IN_USE',
  'auth/weak-password': 'AUTH_WEAK_PASSWORD',
  'auth/password-does-not-meet-requirements': 'AUTH_WEAK_PASSWORD',
  'auth/too-many-requests': 'AUTH_TOO_MANY_ATTEMPTS',
  'auth/requires-recent-login': 'AUTH_RECENT_LOGIN',
  'auth/network-request-failed': 'AUTH_NETWORK',
};

/** Google Sign-In "DEVELOPER_ERROR" (code 10): SHA-1 or web client ID not registered. */
const GOOGLE_CONFIG_CODES = new Set(['10', 'DEVELOPER_ERROR']);

function codeOf(e: unknown): string | null {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === 'string' || typeof c === 'number' ? String(c) : null;
  }
  return null;
}

/** Maps Firebase Auth / Google Sign-In errors to the app error catalogue (LLD §5.2). */
export function mapAuthError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const code = codeOf(e);
  if (__DEV__) {
    // Dev builds only: SDK code + message to diagnose setup problems. Never tokens or user data.
    console.warn('[auth]', code, e instanceof Error ? e.message : String(e));
  }
  if (code !== null) {
    const mapped = FIREBASE_AUTH_CODES[code];
    if (mapped) return new AppError(mapped, { cause: e, retryable: mapped === 'AUTH_NETWORK' });
    if (GOOGLE_CONFIG_CODES.has(code)) return new AppError('AUTH_GOOGLE_CONFIG', { cause: e });
  }
  const message = e instanceof Error ? e.message : '';
  if (message.includes('DEVELOPER_ERROR')) return new AppError('AUTH_GOOGLE_CONFIG', { cause: e });
  return new AppError('APP_UNEXPECTED', { cause: e });
}
