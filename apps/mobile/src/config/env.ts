/**
 * Build-time configuration from `EXPO_PUBLIC_*` variables (apps/mobile/.env.local, git-ignored).
 * These values are embedded in the app bundle and are NOT secret.
 */
export const ENV = {
  /** OAuth client ID of type "Web" from Firebase Auth → Google → Web SDK configuration. */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  /** Twelve Data free-plan key (fallback daily bars). Empty = provider off. Public in the bundle. */
  twelveDataKey: process.env.EXPO_PUBLIC_TWELVEDATA_KEY ?? '',
  /** Finnhub free-plan key (US fundamentals / sector fallback). Empty = provider off. Public. */
  finnhubKey: process.env.EXPO_PUBLIC_FINNHUB_KEY ?? '',
} as const;
