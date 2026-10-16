import type { AppErrorCode } from '@portfolio/core';

/** Service-level failure codes (LLD §3.2); mapped to the app catalogue by {@link toMarketErrorCode}. */
export type ServiceErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'AUTH'
  | 'BAD_RESPONSE'
  | 'PROVIDER_DOWN'
  | 'CURRENCY_MISMATCH'
  | 'UNSUPPORTED';

/** A failed external call. `retryable` tells the HTTP client whether to try again. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    code: ServiceErrorCode,
    provider: string,
    opts: { message?: string; status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(
      opts.message ?? `${provider}: ${code}`,
      opts.cause === undefined ? undefined : { cause: opts.cause },
    );
    this.name = 'ServiceError';
    this.code = code;
    this.provider = provider;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? (code === 'NETWORK' || code === 'TIMEOUT' || code === 'PROVIDER_DOWN');
  }
}

/** True for a {@link ServiceError}. */
export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}

const MD_CODES: Readonly<Record<ServiceErrorCode, AppErrorCode>> = {
  NETWORK: 'MD_NETWORK',
  TIMEOUT: 'MD_TIMEOUT',
  RATE_LIMITED: 'MD_RATE_LIMITED',
  NOT_FOUND: 'MD_NOT_FOUND',
  AUTH: 'MD_PROVIDER_DOWN',
  BAD_RESPONSE: 'MD_BAD_RESPONSE',
  PROVIDER_DOWN: 'MD_PROVIDER_DOWN',
  CURRENCY_MISMATCH: 'MD_CURRENCY_MISMATCH',
  UNSUPPORTED: 'MD_NOT_FOUND',
};

/** App error code for a market-data failure (LLD §5.2). */
export function toMarketErrorCode(e: unknown): AppErrorCode {
  return isServiceError(e) ? MD_CODES[e.code] : 'MD_NETWORK';
}
