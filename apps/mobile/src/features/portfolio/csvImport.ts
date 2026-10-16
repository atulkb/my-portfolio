import {
  CSV_LIMITS,
  parseHoldingsCsv,
  type CsvIssue,
  type DuplicateGroup,
  type NewBuyTransaction,
} from '@portfolio/core';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { localIsoDate } from '@/lib/dates';
import { userMessage } from '@/lib/messages';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { instrumentStore, portfolioStore, sessionStore, toastStore } from '@/stores';

/** What the csv-result sheet shows (S05): blocking issues, or the duplicate review. */
export type CsvSheetContent =
  | {
      readonly kind: 'errors';
      readonly fileName: string;
      readonly errors: readonly CsvIssue[];
      readonly warnings: readonly CsvIssue[];
    }
  | {
      readonly kind: 'duplicates';
      readonly fileName: string;
      readonly groups: readonly DuplicateGroup[];
      readonly incoming: readonly NewBuyTransaction[];
    };

const csvSheetStore = createStore<{ content: CsvSheetContent | null }>()(() => ({ content: null }));

/** Content for the csv-result sheet (kept outside route params: it can be large). */
export function useCsvSheetContent(): CsvSheetContent | null {
  return useStore(csvSheetStore, (s) => s.content);
}

/** How long the import toast (with Undo) stays up (LLD §4.4). */
const IMPORT_TOAST_MS = 10_000;

/** Types offered by the picker; Android file managers label CSVs inconsistently. */
const CSV_TYPES = ['text/*', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream'];

function toastError(code: Parameters<typeof userMessage>[0]): void {
  const text = userMessage(code);
  if (text) toastStore.getState().show(text);
}

/**
 * S05 flow: system file picker → size check → read → validate against the stock list
 * (`core.parseHoldingsCsv`, all-or-nothing) → import with Undo, or open the issues sheet.
 */
export async function importCsvFromPicker(): Promise<void> {
  const pick = await DocumentPicker.getDocumentAsync({ type: CSV_TYPES, copyToCacheDirectory: true });
  if (pick.canceled) return;
  const asset = pick.assets[0];
  if (!asset) return;
  if (asset.size !== undefined && asset.size > CSV_LIMITS.maxBytes) {
    toastError('IMPORT_FILE');
    return;
  }

  let text: string;
  try {
    text = await new File(asset.uri).text();
  } catch {
    toastError('IMPORT_FILE');
    return;
  }

  // Validation needs the stock list (symbols, exchanges, names).
  const index = getInstrumentIndex();
  if (!index) {
    toastError('IMPORT_NO_MASTER');
    void instrumentStore.getState().ensureFresh();
    return;
  }

  const session = sessionStore.getState();
  const result = parseHoldingsCsv(text, {
    fileName: asset.name,
    today: localIsoDate(),
    index,
    existing: portfolioStore.getState().transactions,
    knownPlatforms: session.profile?.platforms ?? [],
  });

  if (!result.ok) {
    csvSheetStore.setState({
      content: { kind: 'errors', fileName: asset.name, errors: result.errors, warnings: result.warnings },
    });
    router.push('/sheets/csv-result');
    return;
  }

  const imported = await portfolioStore.getState().importCsv(result.transactions);
  if (!imported) {
    toastError(portfolioStore.getState().error ?? 'FS_WRITE_FAILED');
    return;
  }
  void session.addPlatforms(result.newPlatforms);
  void session.setSectorOverrides(result.sectorOverrides);

  const count = result.transactions.length;
  const dupRows = result.likelyDuplicates.reduce((n, g) => n + g.incoming.length, 0);
  if (dupRows > 0) {
    csvSheetStore.setState({
      content: {
        kind: 'duplicates',
        fileName: asset.name,
        groups: result.likelyDuplicates,
        incoming: result.transactions,
      },
    });
  }
  toastStore
    .getState()
    .show(
      `${count} ${count === 1 ? 'buy' : 'buys'} imported${dupRows > 0 ? ` · ${dupRows} look like duplicates` : ''}`,
      {
        durationMs: IMPORT_TOAST_MS,
        actions: [
          ...(dupRows > 0 ? [{ label: 'Review', onPress: () => router.push('/sheets/csv-result') }] : []),
          { label: 'Undo', onPress: () => void undoImportWithToast() },
        ],
      },
    );
}

/** Undo last import (toast and Settings → Data). */
export async function undoImportWithToast(): Promise<void> {
  const last = portfolioStore.getState().lastImport;
  const ok = await portfolioStore.getState().undoLastImport();
  if (ok && last)
    toastStore.getState().show(`Removed ${last.count} imported ${last.count === 1 ? 'buy' : 'buys'}.`);
  else if (!ok) toastError(portfolioStore.getState().error ?? 'FS_WRITE_FAILED');
}
