import { AppError, isAppError, type AppErrorCode } from '@portfolio/core';

const CODES: Readonly<Record<string, AppErrorCode>> = {
  'firestore/permission-denied': 'FS_PERMISSION',
  'firestore/unauthenticated': 'FS_PERMISSION',
  'firestore/unavailable': 'FS_UNAVAILABLE',
  'firestore/deadline-exceeded': 'FS_UNAVAILABLE',
  'firestore/resource-exhausted': 'FS_QUOTA',
};

const GRPC_STATUS: Readonly<Record<string, AppErrorCode>> = {
  PERMISSION_DENIED: 'FS_PERMISSION',
  UNAUTHENTICATED: 'FS_PERMISSION',
  UNAVAILABLE: 'FS_UNAVAILABLE',
  DEADLINE_EXCEEDED: 'FS_UNAVAILABLE',
  RESOURCE_EXHAUSTED: 'FS_QUOTA',
};

/** Maps Firestore errors to the app error catalogue (LLD §5.2). */
export function mapFirestoreError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const code =
    e !== null && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  // Transactions surface server errors as `firestore/unknown` with the gRPC status in the message.
  const message = e instanceof Error ? e.message : '';
  const fromMessage = Object.entries(GRPC_STATUS).find(([status]) => message.includes(status))?.[1];
  const mapped = CODES[code] ?? CODES[`firestore/${code}`] ?? fromMessage;
  if (mapped) return new AppError(mapped, { cause: e, retryable: mapped === 'FS_UNAVAILABLE' });
  return new AppError('APP_UNEXPECTED', { cause: e });
}
