import { getApp } from '@react-native-firebase/app';
import {
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
  type AppCheck,
} from '@react-native-firebase/app-check';

import { ENV } from '@/config/env';

let instance: AppCheck | null = null;

/**
 * App Check for Firebase AI Logic (enforced by Firebase from 2026-11-02; supersedes HLD D32).
 * Personal builds, dev or release, are not installed from Google Play, so Play Integrity can't
 * attest them: every build uses the **debug provider**. With `EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN`
 * set (in the git-ignored `.env.local`), every build and device uses that static token, registered
 * once in Firebase console → App Check → Apps → Manage debug tokens (HLD D37). Without it the SDK
 * writes a random debug secret to logcat on first launch, to register the same way. The token is
 * never committed or logged by the app.
 */
export function getAppCheck(): AppCheck {
  if (instance) return instance;
  const provider = new ReactNativeFirebaseAppCheckProvider();
  const debugToken = ENV.appCheckDebugToken || undefined;
  provider.configure({ android: { provider: 'debug', debugToken } });
  instance = initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
  return instance;
}
