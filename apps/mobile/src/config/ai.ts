/**
 * Central Gemini / Firebase AI Logic configuration.
 *
 * Call sites must read model names and limits from here — never hardcode them.
 * Model IDs are retired periodically: confirm the current Flash model in the
 * Firebase console (AI Logic) or Gemini API docs before first use. Later this
 * can be overridden at runtime via Firebase Remote Config.
 */
export const AI_CONFIG = {
  backend: 'googleAI', // Gemini Developer API (free tier) via Firebase AI Logic
  models: {
    // Stable, no Blaze plan needed; shutdown not earlier than 2027-05-19 (verified 2026-10-16,
    // https://firebase.google.com/docs/ai-logic/models). Avoid "short-term stable" and -latest aliases.
    flash: 'gemini-3.5-flash',
    // Stable, shutdown not earlier than 2027-07-21. Candidate for high-volume batch jobs (decided in LLD).
    flashLite: 'gemini-3.5-flash-lite',
  },
  maxOutputTokens: {
    analysis: 1024,
    ruleCompile: 512,
    performanceRatingBatch: 2048,
    signalBatch: 2048,
  },
  temperature: {
    analysis: 0.3,
    ruleCompile: 0,
    performanceRating: 0,
    signal: 0,
  },
  maxRetries: 2,
  performanceRatingBatchSize: 25,
  requestTimeoutMs: 20_000,
} as const;

export type AiConfig = typeof AI_CONFIG;
