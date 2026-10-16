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
  /** Per task (LLD §3.5). Thinking tokens count toward this cap (spike S2), hence the thinking levels below. */
  maxOutputTokens: {
    performanceRating: 2048,
    signals: 2048,
    deepAnalysis: 1024,
    ruleCompile: 512,
    marketSentiment: 256,
  },
  temperature: {
    performanceRating: 0,
    signals: 0,
    deepAnalysis: 0.3,
    ruleCompile: 0,
    marketSentiment: 0.3,
  },
  /** Thinking level per task (SDK `ThinkingLevel` values); the tasks explain supplied numbers only. */
  thinkingLevel: {
    performanceRating: 'MINIMAL',
    signals: 'MINIMAL',
    deepAnalysis: 'LOW',
    ruleCompile: 'LOW',
    marketSentiment: 'MINIMAL',
  },
  /** Retries after the first attempt (≤ 3 attempts in total). */
  maxRetries: 2,
  retryBackoffMs: [1000, 3000],
  /** Items per batch call (performance ratings, signals). */
  batchSize: 25,
  requestTimeoutMs: 20_000,
  /** Client-side budget (LLD §3.12 #4): requests per minute and per local day. */
  rateLimit: { rpm: 5, dailyCap: 500 },
  /** Longest wait for a free per-minute slot before giving up with `AI_BUDGET_EXCEEDED`. */
  maxRpmWaitMs: 60_000,
} as const;

export type AiConfig = typeof AI_CONFIG;
