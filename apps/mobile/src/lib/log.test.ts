import { clearLog, diagnosticsText, log, LOG_CAPACITY } from './log';

describe('log ring buffer', () => {
  beforeEach(clearLog);

  it('keeps the newest entries only', () => {
    for (let i = 0; i < LOG_CAPACITY + 5; i++) log.debug('tick', { i });
    const text = diagnosticsText(['app=1.0']);
    expect(text).toContain(`entries=${LOG_CAPACITY}`);
    expect(text).not.toContain('i=4\n');
    expect(text).toContain(`i=${LOG_CAPACITY + 4}`);
  });

  it('formats fields as key=value after the header', () => {
    log.info('refresh.done', { fetched: 3, failed: ['NSE:X'] });
    const text = diagnosticsText(['app=1.0 (7)']);
    expect(text.startsWith('app=1.0 (7)\nentries=1\n')).toBe(true);
    expect(text).toMatch(/INFO refresh\.done fetched=3 failed=\["NSE:X"\]/);
  });
});
