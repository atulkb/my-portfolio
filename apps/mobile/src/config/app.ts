/** App-wide constants (LLD §4.2). */
export const APP_CONFIG = {
  /** Biometric lock re-engages after the app spent this long in the background. */
  lockAfterBackgroundMs: 5 * 60 * 1000,
} as const;
