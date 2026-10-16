import { AppError, isAppError, type AppErrorCode } from '@portfolio/core';

const CODES: Readonly<Record<string, AppErrorCode>> = {
  'firestore/permission-denied': 'FS_PERMISSION',
  'firestore/unauthenticated': 'FS_PERMISSION',
  'firestore/unavailable': 'FS_UNAVAILABLE',
  'firestore/deadline-exceeded': 'FS_UNAVAILABLE',
  'firestore/resource-exhausted': 'FS_QUOTA',
};

/** Maps Firestore errors to the app error catalogue (LLD §5.2). */
export function mapFirestoreError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const code =
    e !== null && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  const mapped = CODES[code] ?? CODES[`firestore/${code}`];
  if (mapped) return new AppError(mapped, { cause: e, retryable: mapped === 'FS_UNAVAILABLE' });
  return new AppError('APP_UNEXPECTED', { cause: e });
}
