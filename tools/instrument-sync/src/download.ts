import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SNAPSHOT_FILES } from './snapshot';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  Accept: 'text/csv,text/plain,*/*',
};

/** Source URLs (data/instruments/README.md); the later Cloud Function uses the same ones. */
export const SOURCE_URLS = {
  nse: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
  nasdaqListed: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
  otherListed: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
  bse: (yyyymmdd: string): string =>
    `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${yyyymmdd}_F_0000.CSV`,
} as const;

/** How many calendar days back to look for the latest BSE bhavcopy (weekends, holidays). */
const BSE_LOOKBACK_DAYS = 7;

async function fetchText(url: string, extra: Record<string, string> = {}): Promise<string | null> {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...extra },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

/** ISO date `days` before `from` (UTC calendar arithmetic). */
export function isoDaysBefore(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Downloads the four raw files into `outDir` (must not exist yet, so nothing is overwritten).
 * `today` is the folder date; the BSE bhavcopy is the latest one within a week before it.
 */
export async function downloadSnapshot(outDir: string, today: string): Promise<void> {
  if (existsSync(outDir)) throw new Error(`${outDir} already exists — choose a new folder.`);
  const [nse, nasdaqListed, otherListed] = await Promise.all([
    fetchText(SOURCE_URLS.nse, { Referer: 'https://www.nseindia.com/' }),
    fetchText(SOURCE_URLS.nasdaqListed),
    fetchText(SOURCE_URLS.otherListed),
  ]);
  if (!nse || !nasdaqListed || !otherListed) throw new Error('A source list returned 404.');

  let bse: { date: string; text: string } | null = null;
  for (let back = 0; back <= BSE_LOOKBACK_DAYS && !bse; back++) {
    const date = isoDaysBefore(today, back);
    const text = await fetchText(SOURCE_URLS.bse(date.replaceAll('-', '')), {
      Referer: 'https://www.bseindia.com/',
    });
    if (text) bse = { date, text };
  }
  if (!bse) throw new Error(`No BSE bhavcopy found in the ${BSE_LOOKBACK_DAYS} days before ${today}.`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, SNAPSHOT_FILES.nse), nse);
  writeFileSync(join(outDir, SNAPSHOT_FILES.nasdaqListed), nasdaqListed);
  writeFileSync(join(outDir, SNAPSHOT_FILES.otherListed), otherListed);
  writeFileSync(join(outDir, `bse_bhavcopy_${bse.date}.csv`), bse.text);
}
