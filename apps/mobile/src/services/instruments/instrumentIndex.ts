import { buildInstrumentIndex, parseInstrumentTsv, type InstrumentIndex } from '@portfolio/core';

let current: InstrumentIndex | null = null;

/**
 * The parsed master list as a module singleton (LLD §3.6), shared by search, CSV import and
 * `InstrumentRef` construction. Returns the number of malformed lines skipped.
 */
export function setIndexFromTsv(tsv: string): { readonly count: number; readonly skipped: number } {
  const { instruments, skipped } = parseInstrumentTsv(tsv);
  current = buildInstrumentIndex(instruments);
  return { count: instruments.length, skipped };
}

/** The loaded index, or null before the list is available. */
export function getInstrumentIndex(): InstrumentIndex | null {
  return current;
}

/** Drops the index (sign-out). */
export function clearInstrumentIndex(): void {
  current = null;
}
