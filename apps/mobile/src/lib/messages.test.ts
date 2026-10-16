import { APP_ERROR_CODES } from '@portfolio/core';

import { ERROR_MESSAGES, userMessage } from './messages';

describe('userMessage', () => {
  it('has an entry for every catalogued error code', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...APP_ERROR_CODES].sort());
  });

  it('fills placeholders from context', () => {
    expect(userMessage('MD_RATE_LIMITED', { ok: 97, total: 100 })).toBe('Prices updated for 97 of 100.');
    expect(userMessage('FX_UNAVAILABLE', { date: '14 Oct' })).toBe('Using exchange rate from 14 Oct.');
  });

  it('drops missing placeholders instead of showing them raw', () => {
    expect(userMessage('RULE_UNSUPPORTED')).toBe('Rules run on daily closes.');
  });

  it('returns null for silent errors', () => {
    expect(userMessage('AUTH_GOOGLE_CANCELLED')).toBeNull();
  });

  it('never exposes the raw code', () => {
    for (const code of APP_ERROR_CODES) {
      expect(userMessage(code, { ok: 1, total: 2, date: 'x', count: 1 }) ?? '').not.toContain(code);
    }
  });
});
