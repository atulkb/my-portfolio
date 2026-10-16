import type { AppErrorCode, ErrorContext } from '@portfolio/core';

/**
 * User-facing text per error code (LLD §5.2). `null` = silent (logged only). `{name}`
 * placeholders are filled from the error's context. The only place error copy lives.
 */
export const ERROR_MESSAGES: Readonly<Record<AppErrorCode, string | null>> = {
  AUTH_WRONG_PASSWORD: 'Email or password is incorrect.',
  AUTH_EMAIL_IN_USE: 'An account with this email already exists. Sign in instead?',
  AUTH_WEAK_PASSWORD: 'Use at least 8 characters with a number and a symbol.',
  AUTH_TOO_MANY_ATTEMPTS: 'Too many attempts. Try again in a few minutes.',
  AUTH_NOT_VERIFIED: 'Verify your email to continue.',
  AUTH_RECENT_LOGIN: 'Please sign in again to confirm.',
  AUTH_GOOGLE_CANCELLED: null,
  AUTH_GOOGLE_CONFIG: "Google sign-in isn't set up for this build.",
  AUTH_NETWORK: 'No connection. Check your internet.',
  FS_PERMISSION: "You don't have access to this data. Sign in again.",
  FS_UNAVAILABLE: "Can't reach the server. Showing saved data.",
  FS_QUOTA: 'Daily free database limit reached. Changes will sync tomorrow.',
  FS_INVALID_DOC: "{count} record(s) couldn't be read.",
  FS_WRITE_FAILED: "Couldn't save your change. It has been undone.",
  MD_NOT_FOUND: 'No price data',
  MD_STALE: 'as of {date}',
  MD_RATE_LIMITED: 'Prices updated for {ok} of {total}.',
  MD_PROVIDER_DOWN: 'Prices updated for {ok} of {total}.',
  MD_NETWORK: 'Prices updated for {ok} of {total}.',
  MD_TIMEOUT: 'Prices updated for {ok} of {total}.',
  MD_BAD_RESPONSE: 'Prices updated for {ok} of {total}.',
  MD_CURRENCY_MISMATCH: 'Price data looks wrong for this stock; skipped.',
  FX_UNAVAILABLE: 'Using exchange rate from {date}.',
  AI_BUDGET_EXCEEDED: 'AI limit reached for today.',
  AI_RATE_LIMITED: 'AI is busy. Try again in a minute.',
  AI_INVALID_OUTPUT: 'Not rated',
  AI_BLOCKED: "AI couldn't answer this one.",
  AI_NOT_AUTHORISED: 'AI features are unavailable.',
  AI_TIMEOUT: "AI didn't respond. Try again.",
  AI_UNAVAILABLE: "AI didn't respond. Try again.",
  RULE_UNSUPPORTED: '{reason} Rules run on daily closes.',
  RULE_INVALID: "This rule couldn't be understood. Check the issues below.",
  RULE_SCOPE: "This rule uses {variable}, so it can't apply to {scope}.",
  RULE_LIMIT: 'You can have up to 25 rules.',
  IMPORT_INVALID: 'Nothing was imported. Fix the issues below and upload again.',
  IMPORT_NO_MASTER: 'Stock list is still downloading; try again shortly.',
  IMPORT_FILE: "This file can't be read as CSV (max 1 MB).",
  SYNC_HASH_MISMATCH: null,
  SYNC_FAILED: null,
  DEVICE_BIOMETRIC_UNAVAILABLE: 'Set up a fingerprint or face unlock in Android settings first.',
  DEVICE_STORAGE: 'Local storage error. Cached data was reset.',
  LIMIT_WATCHLISTS: 'You can have up to 20 watchlists.',
  LIMIT_WATCHLIST_ITEMS: 'A watchlist can hold up to 100 stocks.',
  APP_OFFLINE: 'Offline · showing data as of {date}',
  APP_UNEXPECTED: 'Something went wrong.',
};

/**
 * Message to show for an error code, or `null` when the error is silent. Unfilled placeholders
 * are removed rather than shown raw.
 */
export function userMessage(code: AppErrorCode, context: ErrorContext = {}): string | null {
  const template = ERROR_MESSAGES[code];
  if (template === null) return null;
  return template
    .replace(/\{(\w+)\}/g, (_, name: string) => String(context[name] ?? ''))
    .replace(/\s{2,}/g, ' ')
    .trim();
}
