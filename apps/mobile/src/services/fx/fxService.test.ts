import type { z } from 'zod';

import { createKeyValueCache, memoryRawStore } from '../cache/kv';
import { ServiceError } from '../http/errors';
import type { HttpClient } from '../http/httpClient';
import usdinr from '../market-data/__fixtures__/yahoo-chart-usdinr.json';
import { createFxService } from './fxService';

// Fri 16 Oct 2026 18:00 IST (IN session of 16 Oct closed).
const EVENING = Date.UTC(2026, 9, 16, 12, 30);

function fakeHttp(routes: (url: string) => unknown) {
  const urls: string[] = [];
  const http: HttpClient = {
    getText: async () => '',
    getJson: async <T>(url: string, schema: z.ZodType<T>) => {
      urls.push(url);
      const body = routes(url);
      if (body instanceof Error) throw body;
      return schema.parse(body);
    },
    resetBreakers: () => undefined,
  };
  return { http, urls };
}

const ecb = (url: string): unknown => {
  if (url.includes('/latest')) return { date: '2026-10-16', rates: { INR: 94.96 } };
  const m = /\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(url);
  return { rates: { [m?.[1] ?? '']: { INR: 82.5 }, [m?.[2] ?? '']: { INR: 94.9 } } };
};

describe('fxService', () => {
  it('fetches latest + history once per IN session, then serves the cache', async () => {
    const { http, urls } = fakeHttp(ecb);
    let now = EVENING;
    const fx = createFxService({
      http,
      kv: createKeyValueCache(memoryRawStore()),
      clock: { now: () => now },
    });
    const r = await fx.get({ historyFrom: '2023-01-10', force: false });
    expect(r?.context.usdInr).toBe(94.96);
    expect(r?.context.asOf).toBe('2026-10-16');
    expect(r?.source).toBe('ECB');
    expect(r?.context.history[0]).toEqual({ date: '2023-01-03', rate: 82.5 });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('/2023-01-03..2026-10-16');

    now += 60_000;
    await fx.get({ historyFrom: '2023-01-10', force: false });
    expect(urls).toHaveLength(2);
    expect(fx.cached()?.context.usdInr).toBe(94.96);
  });

  it('extends history backwards when an older buy appears', async () => {
    const { http, urls } = fakeHttp(ecb);
    const fx = createFxService({
      http,
      kv: createKeyValueCache(memoryRawStore()),
      clock: { now: () => EVENING },
    });
    await fx.get({ historyFrom: '2024-01-10', force: false });
    await fx.get({ historyFrom: '2020-06-10', force: false });
    expect(urls.at(-1)).toContain('/2020-06-03..');
  });

  it('falls back to Yahoo USDINR=X, then to the cached rate', async () => {
    let ecbDown = false;
    let yahooDown = false;
    const { http } = fakeHttp((url) => {
      if (url.includes('frankfurter'))
        return ecbDown ? new ServiceError('PROVIDER_DOWN', 'frankfurter') : ecb(url);
      return yahooDown ? new ServiceError('PROVIDER_DOWN', 'yahoo') : usdinr;
    });
    const fx = createFxService({
      http,
      kv: createKeyValueCache(memoryRawStore()),
      clock: { now: () => EVENING },
    });
    ecbDown = true;
    const y = await fx.get({ historyFrom: null, force: true });
    expect(y?.source).toBe('YAHOO');
    expect(y?.context.usdInr).toBeGreaterThan(80);

    yahooDown = true;
    const c = await fx.get({ historyFrom: null, force: true });
    expect(c?.fromCache).toBe(true);
    expect(c?.context.usdInr).toBe(y?.context.usdInr);
  });

  it('returns null on first launch with no network', async () => {
    const { http } = fakeHttp(() => new ServiceError('NETWORK', 'x'));
    const fx = createFxService({
      http,
      kv: createKeyValueCache(memoryRawStore()),
      clock: { now: () => EVENING },
    });
    await expect(fx.get({ historyFrom: null, force: false })).resolves.toBeNull();
  });
});
