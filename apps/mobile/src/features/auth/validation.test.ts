import { isStrongPassword, looksLikeEmail, passwordChecks } from './validation';

describe('password rules', () => {
  it.each([
    ['short1!', { length: false, number: true, symbol: true }],
    ['longenough', { length: true, number: false, symbol: false }],
    ['Secret#123', { length: true, number: true, symbol: true }],
  ])('%s', (pw, expected) => {
    expect(passwordChecks(pw)).toEqual(expected);
  });

  it('requires all rules', () => {
    expect(isStrongPassword('Secret#123')).toBe(true);
    expect(isStrongPassword('Secret1234')).toBe(false);
  });
});

describe('looksLikeEmail', () => {
  it('accepts plausible emails and rejects others', () => {
    expect(looksLikeEmail(' name@example.com ')).toBe(true);
    expect(looksLikeEmail('name@example')).toBe(false);
    expect(looksLikeEmail('name example.com')).toBe(false);
  });
});
