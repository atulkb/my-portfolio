/**
 * Feature flags. Personal builds enable everything; flip these for a public
 * Play Store release (see docs/HLD.md §11).
 */
export const FEATURES = {
  /** AI-proposed alternative stocks. Personal use only — disable for public release. */
  aiSuggestions: true,
  /** v1.1: daily rule-trigger notifications. */
  notifications: false,
} as const;

export type FeatureFlags = typeof FEATURES;
