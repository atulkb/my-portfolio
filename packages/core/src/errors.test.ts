import { APP_ERROR_CODES, AppError, errorDomain, isAppError, toAppError } from './errors';

describe('AppError', () => {
  it('carries code, retryable flag, context and cause', () => {
    const cause = new Error('socket');
    const e = new AppError('MD_TIMEOUT', { cause, retryable: true, context: { provider: 'yahoo' } });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AppError');
    expect(e.code).toBe('MD_TIMEOUT');
    expect(e.retryable).toBe(true);
    expect(e.context).toEqual({ provider: 'yahoo' });
    expect(e.cause).toBe(cause);
  });

  it('defaults to non-retryable with empty context', () => {
    const e = new AppError('FS_QUOTA');
    expect(e.retryable).toBe(false);
    expect(e.context).toEqual({});
    expect(e.cause).toBeUndefined();
  });
});

describe('toAppError', () => {
  it('passes AppErrors through', () => {
    const e = new AppError('AI_BLOCKED');
    expect(toAppError(e)).toBe(e);
  });

  it('wraps unknown errors as APP_UNEXPECTED', () => {
    const wrapped = toAppError('boom');
    expect(isAppError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('APP_UNEXPECTED');
    expect(wrapped.cause).toBe('boom');
  });
});

describe('errorDomain', () => {
  it('derives the domain from the prefix', () => {
    expect(errorDomain('AUTH_NETWORK')).toBe('AUTH');
    expect(errorDomain('MD_STALE')).toBe('MD');
    expect(errorDomain('LIMIT_WATCHLISTS')).toBe('APP');
    expect(errorDomain('APP_OFFLINE')).toBe('APP');
  });

  it('has unique codes, each with a known domain', () => {
    expect(new Set(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
    for (const code of APP_ERROR_CODES) expect(errorDomain(code)).toBeDefined();
  });
});
