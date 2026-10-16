/** Password rules shown on sign-up (HLD §16): ≥ 8 characters, 1 number, 1 symbol. */
export type PasswordChecks = { readonly length: boolean; readonly number: boolean; readonly symbol: boolean };

/** Evaluates the sign-up password rules. */
export function passwordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9\s]/.test(password),
  };
}

/** True when every password rule passes. */
export function isStrongPassword(password: string): boolean {
  const c = passwordChecks(password);
  return c.length && c.number && c.symbol;
}

/** Lenient email shape check (Firebase does the real validation). */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
