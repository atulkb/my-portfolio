/**
 * Feature flags. Personal builds enable everything; flip these for a public
 * Play Store release (see docs/HLD.md §11).
 */
export const FEATURES = {
  /** AI-proposed alternative stocks. Personal use only — disable for public release. */
  aiSuggestions: true,
  /** Last-resort latest close from a public quote page (HLD D33). Personal builds only. */
  scrapeFallback: true,
  /**
   * Twelve Data for NSE/BSE bars. Off until spike S3 confirms the free plan covers India;
   * US bars use Twelve Data whenever a key is set.
   */
  twelveDataIndia: false,
  /** v1.1: daily rule-trigger notifications. */
  notifications: false,
} as const;

export type FeatureFlags = typeof FEATURES;
