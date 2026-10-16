import { getApp } from '@react-native-firebase/app';
import {
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
  type AppCheck,
} from '@react-native-firebase/app-check';

let instance: AppCheck | null = null;

/**
 * App Check for Firebase AI Logic (enforced by Firebase from 2026-11-02; supersedes HLD D32).
 * Personal builds, dev or release, are not installed from Google Play, so Play Integrity can't
 * attest them: every build uses the **debug provider**. On first launch the SDK writes a debug
 * secret to logcat; register it once in Firebase console → App Check → Apps → Manage debug
 * tokens. The secret is never committed or logged by the app.
 */
export function getAppCheck(): AppCheck {
  if (instance) return instance;
  const provider = new ReactNativeFirebaseAppCheckProvider();
  provider.configure({ android: { provider: 'debug' } });
  instance = initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
  return instance;
}
