import type { z } from 'zod';

import { ServiceError } from './errors';

/** Per-host limits (LLD §3.2). */
export type HostPolicy = {
  readonly concurrency: number;
  /** Minimum gap between request starts (e.g. 200 ms = 5 req/s). */
  readonly minIntervalMs: number;
};

/** Options for one request. */
export type RequestOptions = {
  /** Provider name for errors and logs (e.g. "yahoo"). */
  readonly provider: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Retries after the first attempt on network errors, timeouts and 5xx. */
  readonly retries?: number;
};

/** Injected so tests run without network or real timers. */
export type HttpDeps = {
  readonly fetch: (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<{
    readonly status: number;
    readonly ok: boolean;
    text(): Promise<string>;
  }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly random: () => number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_MS = [500, 1500];
/** Consecutive failures that mark a host down for the rest of the refresh (LLD §3.2). */
const BREAKER_THRESHOLD = 3;
const DEFAULT_POLICY: HostPolicy = { concurrency: 2, minIntervalMs: 500 };

/** HTTP client used by every market-data and FX adapter. */
export type HttpClient = {
  getText(url: string, opts: RequestOptions): Promise<string>;
  getJson<T>(url: string, schema: z.ZodType<T>, opts: RequestOptions): Promise<T>;
  /** Clears circuit breakers; called at the start of each refresh. */
  resetBreakers(): void;
};

type HostState = { active: number; lastStart: number; failures: number; queue: (() => void)[] };

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m?.[1]?.toLowerCase() ?? url;
}

/** URL with secrets (`apikey`, `token`, `crumb`) redacted, for dev logs. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:apikey|token|crumb)=)[^&]*/gi, '$1***');
}

/**
 * Creates the HTTP client (LLD §3.2): timeout, bounded retries with backoff + jitter (no retry
 * on 4xx), per-host concurrency and pacing (requests queue, nothing is dropped) and a circuit
 * breaker per refresh.
 */
export function createHttpClient(
  deps: HttpDeps,
  policies: Readonly<Record<string, HostPolicy>>,
  log: (line: string) => void = () => undefined,
): HttpClient {
  const hosts = new Map<string, HostState>();

  function state(host: string): HostState {
    let s = hosts.get(host);
    if (!s) {
      s = { active: 0, lastStart: 0, failures: 0, queue: [] };
      hosts.set(host, s);
    }
    return s;
  }

  async function acquire(host: string): Promise<void> {
    const s = state(host);
    const policy = policies[host] ?? DEFAULT_POLICY;
    while (s.active >= policy.concurrency) await new Promise<void>((r) => s.queue.push(r));
    s.active += 1;
    const wait = s.lastStart + policy.minIntervalMs - deps.now();
    s.lastStart = Math.max(deps.now(), s.lastStart + policy.minIntervalMs);
    if (wait > 0) await deps.sleep(wait);
  }

  function release(host: string): void {
    const s = state(host);
    s.active -= 1;
    s.queue.shift()?.();
  }

  async function attempt(url: string, opts: RequestOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const started = deps.now();
    try {
      const res = await deps.fetch(url, { headers: { ...opts.headers }, signal: controller.signal });
      log(`${opts.provider} ${res.status} ${deps.now() - started}ms ${redactUrl(url)}`);
      if (res.ok) return await res.text();
      if (res.status === 404) throw new ServiceError('NOT_FOUND', opts.provider, { status: 404 });
      if (res.status === 429) throw new ServiceError('RATE_LIMITED', opts.provider, { status: 429 });
      if (res.status === 401 || res.status === 403)
        throw new ServiceError('AUTH', opts.provider, { status: res.status });
      if (res.status >= 500) throw new ServiceError('PROVIDER_DOWN', opts.provider, { status: res.status });
      throw new ServiceError('BAD_RESPONSE', opts.provider, { status: res.status, retryable: false });
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      if (controller.signal.aborted) throw new ServiceError('TIMEOUT', opts.provider, { cause: e });
      throw new ServiceError('NETWORK', opts.provider, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  async function getText(url: string, opts: RequestOptions): Promise<string> {
    const host = hostOf(url);
    const s = state(host);
    if (s.failures >= BREAKER_THRESHOLD)
      throw new ServiceError('PROVIDER_DOWN', opts.provider, { retryable: false });
    const retries = opts.retries ?? DEFAULT_RETRIES;
    for (let i = 0; ; i++) {
      await acquire(host);
      try {
        const text = await attempt(url, opts);
        s.failures = 0;
        return text;
      } catch (e) {
        const err = e as ServiceError;
        // Only transport-level failures count towards the breaker; 404s are normal answers.
        if (err.retryable) s.failures += 1;
        if (!err.retryable || i >= retries || s.failures >= BREAKER_THRESHOLD) throw err;
      } finally {
        release(host);
      }
      const base = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)] ?? 1500;
      await deps.sleep(base + Math.floor(deps.random() * 250));
    }
  }

  return {
    getText,
    async getJson<T>(url: string, schema: z.ZodType<T>, opts: RequestOptions): Promise<T> {
      const text = await getText(url, opts);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        throw new ServiceError('BAD_RESPONSE', opts.provider, { cause: e, retryable: false });
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new ServiceError('BAD_RESPONSE', opts.provider, { cause: parsed.error, retryable: false });
      return parsed.data;
    },
    resetBreakers: () => {
      for (const s of hosts.values()) s.failures = 0;
    },
  };
}
