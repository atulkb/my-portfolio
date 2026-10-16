import type { AppError } from '@portfolio/core';
import {
  getCrashlytics,
  recordError,
  setCrashlyticsCollectionEnabled,
} from '@react-native-firebase/crashlytics';

/**
 * Enables Crashlytics in release builds only (LLD §5.3). No user ID, email or financial data is
 * ever sent; `setUserId` is never called.
 */
export async function initCrashlytics(): Promise<void> {
  await setCrashlyticsCollectionEnabled(getCrashlytics(), !__DEV__);
}

/** Records an unexpected error by code only (release builds). */
export function reportUnexpected(error: AppError): void {
  if (__DEV__) return;
  const safe = new Error(error.code);
  safe.name = 'AppError';
  recordError(getCrashlytics(), safe);
}
