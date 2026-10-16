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
    flash: 'gemini-2.5-flash', // TODO(verify): replace with the current Flash model ID
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
