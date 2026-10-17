/**
 * App log (LLD §5.3): dev builds print to Metro; every build keeps the last 200 entries in memory
 * for Settings → "Copy diagnostics". Entries hold events, codes, counts and durations only — never
 * tokens, keys, email, prompts, AI replies or CSV contents. Nothing is sent anywhere.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One buffered entry. */
export type LogEntry = {
  readonly at: number;
  readonly level: LogLevel;
  readonly event: string;
  readonly detail: string;
};

/** Ring buffer size. */
export const LOG_CAPACITY = 200;

const buffer: LogEntry[] = [];

function write(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void {
  const detail = fields
    ? Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    : '';
  buffer.push({ at: Date.now(), level, event, detail });
  if (buffer.length > LOG_CAPACITY) buffer.splice(0, buffer.length - LOG_CAPACITY);
  if (__DEV__ && level !== 'debug') console.log(`[${event}] ${detail}`);
}

/** Structured logger: `log.info('refresh.done', { fetched: 12, ms: 3400 })`. */
export const log = {
  debug: (event: string, fields?: Readonly<Record<string, unknown>>) => write('debug', event, fields),
  info: (event: string, fields?: Readonly<Record<string, unknown>>) => write('info', event, fields),
  warn: (event: string, fields?: Readonly<Record<string, unknown>>) => write('warn', event, fields),
  error: (event: string, fields?: Readonly<Record<string, unknown>>) => write('error', event, fields),
};

/** The buffered entries as plain text, oldest first, for the clipboard. */
export function diagnosticsText(header: readonly string[]): string {
  const lines = buffer.map((e) =>
    `${new Date(e.at).toISOString()} ${e.level.toUpperCase()} ${e.event} ${e.detail}`.trimEnd(),
  );
  return [...header, `entries=${buffer.length}`, '', ...lines].join('\n');
}

/** Test helper: empties the buffer. */
export function clearLog(): void {
  buffer.length = 0;
}
