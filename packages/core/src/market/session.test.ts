import { isMarketClosed, marketLocalTime, sessionDateFor } from './session';

const at = (iso: string): number => Date.parse(iso);

describe('sessionDateFor', () => {
  it.each([
    // India (UTC+5:30, close 15:30 IST = 10:00 UTC)
    ['IN', '2026-10-15T09:59:00Z', '2026-10-14'], // Thu 15:29 IST → Wed
    ['IN', '2026-10-15T10:00:00Z', '2026-10-15'], // Thu 15:30 IST → Thu
    ['IN', '2026-10-17T06:00:00Z', '2026-10-16'], // Sat → Fri
    ['IN', '2026-10-19T03:00:00Z', '2026-10-16'], // Mon 08:30 IST → Fri
    // US (EDT = UTC−4 in October, close 16:00 ET = 20:00 UTC)
    ['US', '2026-10-15T19:59:00Z', '2026-10-14'],
    ['US', '2026-10-15T20:00:00Z', '2026-10-15'],
    ['US', '2026-10-16T02:00:00Z', '2026-10-15'], // Thu 22:00 ET, already Fri in UTC
    ['US', '2026-10-18T15:00:00Z', '2026-10-16'], // Sun → Fri
    // US in winter (EST = UTC−5): close at 21:00 UTC
    ['US', '2026-12-15T20:30:00Z', '2026-12-14'],
    ['US', '2026-12-15T21:00:00Z', '2026-12-15'],
  ] as const)('%s at %s → %s', (market, now, expected) => {
    expect(sessionDateFor(market, at(now))).toBe(expected);
  });
});

describe('marketLocalTime', () => {
  it('converts to exchange-local date and minutes', () => {
    expect(marketLocalTime('IN', at('2026-10-15T18:45:00Z'))).toEqual({ date: '2026-10-16', minutes: 15 });
  });
});

describe('isMarketClosed', () => {
  it.each([
    ['IN', '2026-10-15T03:44:00Z', true], // 09:14 IST
    ['IN', '2026-10-15T03:45:00Z', false], // 09:15 IST
    ['IN', '2026-10-15T10:00:00Z', true], // 15:30 IST
    ['US', '2026-10-15T14:00:00Z', false], // 10:00 ET
    ['US', '2026-10-17T15:00:00Z', true], // Saturday
  ] as const)('%s at %s → %s', (market, now, expected) => {
    expect(isMarketClosed(market, at(now))).toBe(expected);
  });
});
