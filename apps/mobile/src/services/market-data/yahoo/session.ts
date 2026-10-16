import type { HttpClient } from '../../http/httpClient';
import { isServiceError, ServiceError } from '../../http/errors';

/**
 * Desktop browser UA for every Yahoo call: Yahoo answers 429 to mobile browser agents on
 * `getcrumb` and, at times, on the chart endpoint (checked 2026-10-16); the crumb is also tied
 * to the agent that obtained it.
 */
export const YAHOO_DESKTOP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
};

const CRUMB = /^[A-Za-z0-9./_-]{6,64}$/;

/** After a failed crumb fetch, quoteSummary is skipped for this long (no hammering). */
export const CRUMB_RETRY_MS = 10 * 60 * 1000;

/** Yahoo session crumb for quoteSummary, kept in memory for the app session. */
export type YahooSession = {
  /** The cached crumb, or a fresh one (single flight). Throws `AUTH` when none can be obtained. */
  crumb(): Promise<string>;
  /** Forgets the crumb after a 401 so the next call fetches a new one. */
  invalidate(): void;
};

/**
 * Cookie + crumb flow (LLD §3.3): `GET https://fc.yahoo.com` sets the session cookie (the 404 it
 * answers with is expected; the platform cookie jar keeps the cookie), then
 * `GET /v1/test/getcrumb` returns the crumb as plain text. A failure is remembered for
 * {@link CRUMB_RETRY_MS} so one refresh doesn't retry it per instrument.
 */
export function createYahooSession(http: HttpClient, host: string, now: () => number): YahooSession {
  let pending: Promise<string> | null = null;
  let failed: { at: number; error: unknown } | null = null;

  async function obtain(): Promise<string> {
    try {
      await http.getText('https://fc.yahoo.com', {
        provider: 'yahoo',
        headers: YAHOO_DESKTOP_HEADERS,
        retries: 0,
      });
    } catch (e) {
      // 404 is the normal answer; anything else may still have set the cookie, so carry on.
      if (!isServiceError(e)) throw e;
    }
    const text = (
      await http.getText(`${host}/v1/test/getcrumb`, {
        provider: 'yahoo',
        headers: YAHOO_DESKTOP_HEADERS,
        retries: 0,
      })
    ).trim();
    if (!CRUMB.test(text)) throw new ServiceError('AUTH', 'yahoo', { message: 'yahoo: no crumb' });
    return text;
  }

  return {
    crumb() {
      if (failed && now() - failed.at < CRUMB_RETRY_MS) return Promise.reject(failed.error);
      pending ??= obtain().then(
        (crumb) => {
          failed = null;
          return crumb;
        },
        (e: unknown) => {
          pending = null;
          failed = { at: now(), error: e };
          throw e;
        },
      );
      return pending;
    },
    invalidate() {
      pending = null;
    },
  };
}
