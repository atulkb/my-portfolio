/**
 * Build-time configuration from `EXPO_PUBLIC_*` variables (apps/mobile/.env.local, git-ignored).
 * These values are embedded in the app bundle and are NOT secret.
 */
export const ENV = {
  /** OAuth client ID of type "Web" from Firebase Auth → Google → Web SDK configuration. */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
} as const;
