/** App-wide error model (LLD §5.1). User-facing text lives in the app's `messages.ts`, keyed by code. */

/** Every error code in the LLD §5.2 catalogue. */
export const APP_ERROR_CODES = [
  'AUTH_WRONG_PASSWORD',
  'AUTH_EMAIL_IN_USE',
  'AUTH_WEAK_PASSWORD',
  'AUTH_TOO_MANY_ATTEMPTS',
  'AUTH_NOT_VERIFIED',
  'AUTH_RECENT_LOGIN',
  'AUTH_GOOGLE_CANCELLED',
  'AUTH_GOOGLE_CONFIG',
  'AUTH_NETWORK',
  'FS_PERMISSION',
  'FS_UNAVAILABLE',
  'FS_QUOTA',
  'FS_INVALID_DOC',
  'FS_WRITE_FAILED',
  'MD_NOT_FOUND',
  'MD_STALE',
  'MD_RATE_LIMITED',
  'MD_PROVIDER_DOWN',
  'MD_NETWORK',
  'MD_TIMEOUT',
  'MD_BAD_RESPONSE',
  'MD_CURRENCY_MISMATCH',
  'FX_UNAVAILABLE',
  'AI_BUDGET_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_INVALID_OUTPUT',
  'AI_BLOCKED',
  'AI_NOT_AUTHORISED',
  'AI_TIMEOUT',
  'AI_UNAVAILABLE',
  'RULE_UNSUPPORTED',
  'RULE_INVALID',
  'RULE_SCOPE',
  'RULE_LIMIT',
  'IMPORT_INVALID',
  'IMPORT_NO_MASTER',
  'IMPORT_FILE',
  'SYNC_HASH_MISMATCH',
  'SYNC_FAILED',
  'DEVICE_BIOMETRIC_UNAVAILABLE',
  'DEVICE_STORAGE',
  'LIMIT_WATCHLISTS',
  'LIMIT_WATCHLIST_ITEMS',
  'APP_OFFLINE',
  'APP_UNEXPECTED',
] as const;

/** One catalogued error code. */
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Area an error belongs to. */
export type ErrorDomain = 'AUTH' | 'FS' | 'MD' | 'FX' | 'AI' | 'RULE' | 'SYNC' | 'IMPORT' | 'DEVICE' | 'APP';

const DOMAIN_BY_PREFIX: Readonly<Record<string, ErrorDomain>> = {
  AUTH: 'AUTH',
  FS: 'FS',
  MD: 'MD',
  FX: 'FX',
  AI: 'AI',
  RULE: 'RULE',
  SYNC: 'SYNC',
  IMPORT: 'IMPORT',
  DEVICE: 'DEVICE',
  LIMIT: 'APP',
  APP: 'APP',
};

/** Domain of an error code, derived from its prefix. */
export function errorDomain(code: AppErrorCode): ErrorDomain {
  return DOMAIN_BY_PREFIX[code.slice(0, code.indexOf('_'))] ?? 'APP';
}

/**
 * Extra data for building the user message. Must never contain email, display name, broker
 * names, prompts or AI output (HLD §10 privacy).
 */
export type ErrorContext = Readonly<Record<string, string | number>>;

/** Options for {@link AppError}. */
export type AppErrorOptions = {
  readonly cause?: unknown;
  readonly retryable?: boolean;
  readonly context?: ErrorContext;
};

/** The only error type services throw. Stores map it to state; components never see raw errors. */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly context: ErrorContext;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }
}

/** Type guard for {@link AppError}. */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Passes `AppError`s through and wraps anything else as `APP_UNEXPECTED`. SDK-specific mapping
 * (Firebase, HTTP, Gemini) happens in the app's service layer before this fallback.
 */
export function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : new AppError('APP_UNEXPECTED', { cause: e });
}
