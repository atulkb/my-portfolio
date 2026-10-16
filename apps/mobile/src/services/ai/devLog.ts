/**
 * Dev builds only: the last AI client diagnostics (task, attempts, tokens, validator reasons —
 * never prompts or replies), shown in Settings because RN 0.86 console output is unreliable.
 */
const MAX_LINES = 12;
let lines: readonly string[] = [];
const listeners = new Set<() => void>();

/** Appends one diagnostic line. */
export function pushAiDevLog(line: string): void {
  lines = [...lines.slice(-(MAX_LINES - 1)), `${new Date().toTimeString().slice(0, 8)} ${line}`];
  listeners.forEach((l) => l());
}

/** Current lines (stable reference between pushes, for `useSyncExternalStore`). */
export function getAiDevLog(): readonly string[] {
  return lines;
}

/** Subscribes to new lines; returns the unsubscribe function. */
export function subscribeAiDevLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
