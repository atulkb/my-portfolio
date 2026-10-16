import {
  applyBuyPatch,
  newBuyTransactionSchema,
  normalisePlatform,
  toAppError,
  toInstrumentKey,
  type AppErrorCode,
  type BuyTransaction,
  type BuyTransactionPatch,
  type Clock,
  type InstrumentKey,
  type IsoDate,
  type KeyValueCache,
  type NewBuyTransaction,
  type TransactionRepository,
} from '@portfolio/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { KV_KEYS } from '@/services/cache/keys';

/** How long "Undo last import" stays available (LLD §1.5). */
export const UNDO_IMPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const LastImportSchema = z.object({
  importBatchId: z.string().min(1),
  importedAt: z.number(),
  count: z.number().int().positive(),
});
/** The most recent CSV upload, kept in MMKV `import.lastBatch` for 7 days. */
export type LastImport = z.infer<typeof LastImportSchema>;

/** Portfolio store state and actions (LLD §4.3). All writes are optimistic (§3.7). */
export type PortfolioState = {
  readonly transactions: readonly BuyTransaction[];
  readonly loadState: 'idle' | 'loading' | 'ready' | 'error';
  /** Documents that failed validation on the last load (shown once as a toast). */
  readonly skipped: number;
  /** Writes not yet acknowledged by the server (offline → "Saving… will sync when online"). */
  readonly pendingWrites: number;
  readonly lastImport: LastImport | null;
  /** Last load or write failure; a failed write has already been rolled back. */
  readonly error: AppErrorCode | null;
  load(): Promise<void>;
  /** Validates and adds one manual buy. Returns false when invalid or the write failed. */
  addBuy(tx: NewBuyTransaction): Promise<boolean>;
  updateBuy(id: string, patch: BuyTransactionPatch): Promise<boolean>;
  deleteBuys(ids: readonly string[]): Promise<boolean>;
  /** Deletes every buy of a stock (S02b → Remove, "Delete all records"). */
  removeHolding(key: InstrumentKey): Promise<boolean>;
  /** Deletes a stock's buys on one platform (S02c). */
  removeFromBroker(key: InstrumentKey, platform: string): Promise<boolean>;
  /** Adds a validated CSV upload under a fresh import batch ID. */
  importCsv(txs: readonly NewBuyTransaction[]): Promise<boolean>;
  undoLastImport(): Promise<boolean>;
  clearError(): void;
  /** Forgets everything (sign-out). */
  reset(): void;
};

/** Dependencies, injected so tests use fakes. */
export type PortfolioDeps = {
  /** Repository for the signed-in user; null when signed out. */
  readonly repo: () => TransactionRepository | null;
  readonly kv: KeyValueCache;
  readonly clock: Clock;
  /** Device-local calendar date (trade dates may not be in the future). */
  readonly today: () => IsoDate;
  readonly newBatchId: () => string;
};

const keyOf = (tx: Pick<BuyTransaction, 'exchange' | 'symbol'>): InstrumentKey =>
  toInstrumentKey(tx.exchange, tx.symbol);

/** Creates the portfolio store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createPortfolioStore(deps: PortfolioDeps): StoreApi<PortfolioState> {
  return createStore<PortfolioState>()((set, get) => {
    function readLastImport(): LastImport | null {
      const last = deps.kv.get(KV_KEYS.importLastBatch, LastImportSchema);
      if (last && deps.clock.now() - last.importedAt > UNDO_IMPORT_WINDOW_MS) {
        deps.kv.delete(KV_KEYS.importLastBatch);
        return null;
      }
      return last;
    }

    /**
     * Applies `change` locally, runs `write`, and on failure applies `undo` to whatever the list
     * looks like by then (other changes made meanwhile survive).
     */
    async function optimistic(
      change: (txs: readonly BuyTransaction[]) => readonly BuyTransaction[],
      undo: (txs: readonly BuyTransaction[]) => readonly BuyTransaction[],
      write: (repo: TransactionRepository) => Promise<unknown>,
    ): Promise<boolean> {
      const repo = deps.repo();
      if (!repo) return false;
      set((s) => ({ transactions: change(s.transactions), pendingWrites: s.pendingWrites + 1, error: null }));
      try {
        await write(repo);
        return true;
      } catch (e) {
        const code = toAppError(e).code;
        set((s) => ({
          transactions: undo(s.transactions),
          error: code === 'APP_UNEXPECTED' ? 'FS_WRITE_FAILED' : code,
        }));
        return false;
      } finally {
        set((s) => ({ pendingWrites: s.pendingWrites - 1 }));
      }
    }

    function localDocs(
      items: readonly { id: string; tx: NewBuyTransaction }[],
      importBatchId: string | null,
    ): BuyTransaction[] {
      const now = deps.clock.now();
      return items.map(({ id, tx }) => ({
        ...tx,
        id,
        schemaVersion: 1,
        importBatchId,
        createdAt: now,
        updatedAt: now,
      }));
    }

    async function addItems(
      txs: readonly NewBuyTransaction[],
      importBatchId: string | null,
    ): Promise<boolean> {
      const repo = deps.repo();
      if (!repo || txs.length === 0) return false;
      const ids = repo.newIds(txs.length);
      const items = txs.map((tx, i) => ({ id: ids[i] as string, tx }));
      const added = new Set(ids);
      return optimistic(
        (list) => [...list, ...localDocs(items, importBatchId)],
        (list) => list.filter((t) => !added.has(t.id)),
        (r) => r.addMany(items, importBatchId),
      );
    }

    async function deleteWhere(pred: (t: BuyTransaction) => boolean): Promise<boolean> {
      const removed = get().transactions.filter(pred);
      if (removed.length === 0) return true;
      const ids = new Set(removed.map((t) => t.id));
      return optimistic(
        (list) => list.filter((t) => !ids.has(t.id)),
        (list) => [...list.filter((t) => !ids.has(t.id)), ...removed],
        (r) => r.deleteMany([...ids]),
      );
    }

    return {
      transactions: [],
      loadState: 'idle',
      skipped: 0,
      pendingWrites: 0,
      lastImport: null,
      error: null,

      load: async () => {
        const repo = deps.repo();
        if (!repo) return;
        set({ loadState: 'loading', error: null, lastImport: readLastImport() });
        try {
          const { items, skipped } = await repo.listAll();
          set({ transactions: items, skipped, loadState: 'ready' });
        } catch (e) {
          set({ loadState: 'error', error: toAppError(e).code });
        }
      },

      addBuy: async (tx) => {
        const parsed = newBuyTransactionSchema(deps.today()).safeParse(tx);
        if (!parsed.success) return false;
        return addItems([parsed.data], null);
      },

      updateBuy: async (id, patch) => {
        const current = get().transactions.find((t) => t.id === id);
        if (!current) return false;
        const parsed = applyBuyPatch(current, patch, deps.today());
        if (!parsed.success) return false;
        const { platform, quantity, price, tradeDate } = parsed.data;
        const clean: BuyTransactionPatch = { platform, quantity, price, tradeDate };
        const updated: BuyTransaction = { ...current, ...clean, updatedAt: deps.clock.now() };
        return optimistic(
          (list) => list.map((t) => (t.id === id ? updated : t)),
          (list) => list.map((t) => (t.id === id ? current : t)),
          (r) => r.update(id, clean),
        );
      },

      deleteBuys: (ids) => {
        const set_ = new Set(ids);
        return deleteWhere((t) => set_.has(t.id));
      },

      removeHolding: (key) => deleteWhere((t) => keyOf(t) === key),

      removeFromBroker: (key, platform) => {
        const p = normalisePlatform(platform);
        return deleteWhere((t) => keyOf(t) === key && normalisePlatform(t.platform) === p);
      },

      importCsv: async (txs) => {
        const importBatchId = deps.newBatchId();
        const ok = await addItems(txs, importBatchId);
        if (ok) {
          const lastImport: LastImport = { importBatchId, importedAt: deps.clock.now(), count: txs.length };
          deps.kv.set(KV_KEYS.importLastBatch, lastImport);
          set({ lastImport });
        }
        return ok;
      },

      undoLastImport: async () => {
        const last = get().lastImport;
        if (!last) return false;
        const removed = get().transactions.filter((t) => t.importBatchId === last.importBatchId);
        const ok = await optimistic(
          (list) => list.filter((t) => t.importBatchId !== last.importBatchId),
          (list) => [...list.filter((t) => t.importBatchId !== last.importBatchId), ...removed],
          (r) => r.deleteByImportBatch(last.importBatchId),
        );
        if (ok) {
          deps.kv.delete(KV_KEYS.importLastBatch);
          set({ lastImport: null });
        }
        return ok;
      },

      clearError: () => set({ error: null }),

      reset: () =>
        set({
          transactions: [],
          loadState: 'idle',
          skipped: 0,
          pendingWrites: 0,
          lastImport: null,
          error: null,
        }),
    };
  });
}
