import {
  findListing,
  searchInstruments,
  type AppErrorCode,
  type Exchange,
  type Instrument,
  type InstrumentIndex,
  type InstrumentMasterMeta,
  type Listing,
  type Market,
  type SearchHit,
} from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { InstrumentSyncService } from '@/services/instruments/instrumentSyncService';

/** Stock-list status (LLD §4.3). */
export type InstrumentStatus = 'missing' | 'downloading' | 'ready' | 'error';

/** Instrument store state and actions. */
export type InstrumentState = {
  readonly status: InstrumentStatus;
  readonly meta: InstrumentMasterMeta | null;
  /** Last sync failure (the previous copy, if any, stays in use). */
  readonly error: AppErrorCode | null;
  /** Loads the local copy, then checks for a newer version in the background. */
  ensureFresh(opts?: { readonly force?: boolean }): Promise<void>;
  /** Ranked search over the loaded list (top 20); empty while the list is missing. */
  search(query: string, market?: Market): SearchHit[];
  /** Exact listing lookup. */
  resolve(exchange: Exchange, symbol: string): { instrument: Instrument; listing: Listing } | null;
  /** Forgets the list (sign-out; local storage is wiped separately). */
  reset(): void;
};

/** Dependencies, injected so tests use fakes. */
export type InstrumentStoreDeps = {
  readonly sync: InstrumentSyncService;
  readonly getIndex: () => InstrumentIndex | null;
  readonly setIndexFromTsv: (tsv: string) => { readonly count: number; readonly skipped: number };
  readonly clearIndex: () => void;
};

/** Creates the instrument store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createInstrumentStore(deps: InstrumentStoreDeps): StoreApi<InstrumentState> {
  let running: Promise<void> | null = null;

  return createStore<InstrumentState>()((set, get) => {
    function hydrate(): void {
      if (deps.getIndex()) return;
      const local = deps.sync.loadLocal();
      if (!local) return;
      deps.setIndexFromTsv(local.tsv);
      set({ status: 'ready', meta: local.meta });
    }

    async function run(force: boolean): Promise<void> {
      hydrate();
      if (!deps.getIndex()) set({ status: 'downloading', error: null });
      const outcome = await deps.sync.ensureFresh({ force });
      if (outcome.kind === 'updated') {
        deps.setIndexFromTsv(outcome.tsv);
        set({ status: 'ready', meta: outcome.meta, error: null });
      } else if (outcome.kind === 'failed') {
        set({ status: deps.getIndex() ? 'ready' : 'error', error: outcome.error.code });
      } else {
        set({ error: null });
      }
    }

    return {
      status: 'missing',
      meta: null,
      error: null,

      ensureFresh: (opts = {}) => {
        // A second call joins the running one.
        running ??= run(opts.force ?? false).finally(() => {
          running = null;
        });
        return running;
      },
      search: (query, market) => {
        const index = deps.getIndex();
        if (!index) return [];
        return searchInstruments(index, query, market ? { market } : {});
      },
      resolve: (exchange, symbol) => {
        const index = deps.getIndex();
        return index ? findListing(index, exchange, symbol) : null;
      },
      reset: () => {
        deps.clearIndex();
        if (get().status !== 'missing') set({ status: 'missing', meta: null, error: null });
      },
    };
  });
}
