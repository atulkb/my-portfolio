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
  /**
   * Model chain, best first (HLD D36). Each model has its own free-tier "requests per day" quota,
   * so the app uses the first model with quota left and steps down as each runs out; the order
   * starts again at the top each quota day. Limits are the project's free-tier RPD as shown in
   * Google AI Studio → Rate limits (checked 2026-10-17). `thinking` picks the SDK parameter:
   * Gemini 3.x takes `thinkingLevel`, Gemini 2.5 takes `thinkingBudget`.
   */
  modelChain: [
    { id: 'gemini-3.8-flash', dailyLimit: 20, thinking: 'level' },
    { id: 'gemini-3.7-flash', dailyLimit: 20, thinking: 'level' },
    { id: 'gemini-2.5-flash', dailyLimit: 20, thinking: 'budget' },
    { id: 'gemini-3.5-flash-lite', dailyLimit: 500, thinking: 'level' },
    { id: 'gemini-3.1-flash-lite', dailyLimit: 500, thinking: 'level' },
  ],
  /** Gemini free-tier daily quotas reset at midnight Pacific time; counters follow that day. */
  quotaTimeZone: 'America/Los_Angeles',
  /**
   * After a 429 the model is skipped for this long (it may be the per-minute limit, not the day's,
   * so it is not written off for the whole day).
   */
  rateLimitCooldownMs: 60 * 60 * 1000,
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
  /**
   * Thinking level per task (SDK `ThinkingLevel` values); the tasks explain supplied numbers only.
   * Gemini 2.5 models get the matching `thinkingBudget` from {@link THINKING_BUDGET}.
   */
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
  /** Client-side pacing (LLD §3.12 #4): requests per minute across all models. */
  rateLimit: { rpm: 5 },
  /** Longest wait for a free per-minute slot before giving up with `AI_BUDGET_EXCEEDED`. */
  maxRpmWaitMs: 60_000,
} as const;

export type AiConfig = typeof AI_CONFIG;

/** One model of the chain. */
export type ChainModel = (typeof AI_CONFIG.modelChain)[number];

/** `thinkingBudget` tokens for Gemini 2.5 models, per thinking level. */
export const THINKING_BUDGET = { MINIMAL: 0, LOW: 512 } as const;
