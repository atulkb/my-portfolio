/**
 * Dev-only diagnostic text for an error and its cause chain (SDK code + message), e.g.
 * `APP_UNEXPECTED ← firestore/not-found: database does not exist`. Returns `null` in release
 * builds. Contains no tokens or user data — only SDK codes and messages.
 */
export function devErrorDetail(e: unknown): string | null {
  if (!__DEV__) return null;
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur !== undefined && cur !== null && depth < 4; depth++) {
    const code = typeof cur === 'object' && 'code' in cur ? String((cur as { code: unknown }).code) : '';
    const message = cur instanceof Error ? cur.message : String(cur);
    parts.push(code && code !== message ? `${code}: ${message}` : message);
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts.join(' ← ');
}
