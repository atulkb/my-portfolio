import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { InstrumentMasterMeta, RawSources } from '@portfolio/core';

/** File names inside a snapshot folder (data/instruments/README.md). */
export const SNAPSHOT_FILES = {
  nse: 'nse_equity_list.csv',
  nasdaqListed: 'us_nasdaqlisted.txt',
  otherListed: 'us_otherlisted.txt',
  bsePattern: /^bse_bhavcopy_(\d{4}-\d{2}-\d{2})\.csv$/,
} as const;

const FOLDER_RE = /snapshot-(\d{4}-\d{2}-\d{2})$/;

/** A snapshot folder's raw files and the dates they describe. */
export type Snapshot = {
  readonly sources: RawSources;
  readonly sourceDates: InstrumentMasterMeta['sourceDates'];
};

/**
 * Source dates: BSE from the bhavcopy file name (its trading day), NSE and US from the folder
 * name (`snapshot-<YYYY-MM-DD>` = download day; those lists carry no date of their own).
 *
 * @throws Error when the folder name or file names don't follow the convention.
 */
export function snapshotDates(
  folder: string,
  fileNames: readonly string[],
): {
  readonly bseFile: string;
  readonly sourceDates: InstrumentMasterMeta['sourceDates'];
} {
  const folderDate = FOLDER_RE.exec(basename(folder))?.[1];
  if (!folderDate) throw new Error(`Folder name must end in snapshot-YYYY-MM-DD: ${folder}`);
  const bse = fileNames
    .map((f) => ({ f, m: SNAPSHOT_FILES.bsePattern.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => a.f.localeCompare(b.f))
    .at(-1);
  if (!bse?.m[1]) throw new Error(`No bse_bhavcopy_YYYY-MM-DD.csv in ${folder}`);
  return {
    bseFile: bse.f,
    sourceDates: { nse: folderDate, bse: bse.m[1], us: folderDate },
  };
}

/** Reads the four raw files of a snapshot folder. */
export function readSnapshot(folder: string): Snapshot {
  const { bseFile, sourceDates } = snapshotDates(folder, readdirSync(folder));
  const read = (name: string): string => readFileSync(join(folder, name), 'utf8');
  return {
    sources: {
      nseEquityCsv: read(SNAPSHOT_FILES.nse),
      bseBhavcopyCsv: read(bseFile),
      nasdaqListed: read(SNAPSHOT_FILES.nasdaqListed),
      otherListed: read(SNAPSHOT_FILES.otherListed),
    },
    sourceDates,
  };
}

/** Latest of the source dates (ISO strings sort chronologically). */
export function maxSourceDate(d: InstrumentMasterMeta['sourceDates']): string {
  return [d.nse, d.bse, d.us].sort().at(-1) ?? d.nse;
}
