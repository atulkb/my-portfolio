import {
  NewWatchlistItemSchema,
  toAppError,
  toInstrumentKey,
  WATCHLIST_LIMITS,
  type AppErrorCode,
  type Clock,
  type Exchange,
  type InstrumentKey,
  type NewWatchlistItem,
  type Watchlist,
  type WatchlistItem,
  type WatchlistRepository,
} from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** Maximum watchlist name length (LLD §1.6). */
export const MAX_WATCHLIST_NAME = 40;

/** Editable fields of a watchlist item (S07 long-press → edit). */
export type WatchlistItemPatch = Pick<NewWatchlistItem, 'targetEntryPrice' | 'targetExitPrice' | 'notes'>;

/** Watchlist store state (LLD §4.3). Writes are optimistic and rolled back on failure (§3.7). */
export type WatchlistState = {
  /** Sorted by `sortOrder`. */
  readonly watchlists: readonly Watchlist[];
  readonly itemsByList: Readonly<Record<string, readonly WatchlistItem[]>>;
  /** List shown on S07; the first list when unset or deleted. */
  readonly activeListId: string | null;
  readonly loadState: 'idle' | 'loading' | 'ready' | 'error';
  /** Documents that failed validation on the last load. */
  readonly skipped: number;
  /** Last write failure (already rolled back) or limit hit. */
  readonly error: AppErrorCode | null;
  load(): Promise<void>;
  /** Returns the new list's ID, or null when invalid / at the limit / the write failed. */
  create(name: string): Promise<string | null>;
  rename(id: string, name: string): Promise<boolean>;
  /** Deletes a list and its items; the last remaining list cannot be deleted. */
  remove(id: string): Promise<boolean>;
  /**
   * Sets which lists hold an instrument (S04 ★ / watchlist-pick): adds it to `listIds` it is
   * missing from and removes it from the others. `template` carries targets and notes into the
   * new lists (copy / move); otherwise they start empty.
   */
  setMembership(
    ref: { exchange: Exchange; symbol: string },
    listIds: readonly string[],
    template?: WatchlistItemPatch,
  ): Promise<boolean>;
  updateItem(listId: string, key: InstrumentKey, patch: WatchlistItemPatch): Promise<boolean>;
  removeItem(listId: string, key: InstrumentKey): Promise<boolean>;
  setActive(id: string): void;
  clearError(): void;
  reset(): void;
};

/** Dependencies, injected so tests use fakes. */
export type WatchlistDeps = {
  /** Repository for the signed-in user; null when signed out. */
  readonly repo: () => WatchlistRepository | null;
  readonly clock: Clock;
};

/** Why a watchlist name can't be used, or null when it can (unique per user, case-insensitive). */
export function watchlistNameIssue(
  name: string,
  lists: readonly Watchlist[],
  exceptId: string | null = null,
): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Enter a name.';
  if (n.length > MAX_WATCHLIST_NAME) return `Use at most ${MAX_WATCHLIST_NAME} characters.`;
  const lower = n.toLocaleLowerCase();
  if (lists.some((l) => l.id !== exceptId && l.name.trim().toLocaleLowerCase() === lower))
    return 'You already have a list with this name.';
  return null;
}

const itemKey = (i: Pick<WatchlistItem, 'exchange' | 'symbol'>): InstrumentKey =>
  toInstrumentKey(i.exchange, i.symbol);

const sorted = (lists: readonly Watchlist[]): Watchlist[] =>
  [...lists].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);

/** Every instrument on any watchlist, in list order, without duplicates. */
export function allWatchedKeys(s: Pick<WatchlistState, 'watchlists' | 'itemsByList'>): InstrumentKey[] {
  const out = new Set<InstrumentKey>();
  for (const l of s.watchlists) for (const i of s.itemsByList[l.id] ?? []) out.add(itemKey(i));
  return [...out];
}

/** Creates the watchlist store (vanilla zustand; bound to React in `stores/index.ts`). */
export function createWatchlistStore(deps: WatchlistDeps): StoreApi<WatchlistState> {
  const empty = {
    watchlists: [],
    itemsByList: {},
    activeListId: null,
    loadState: 'idle',
    skipped: 0,
    error: null,
  } as const;

  return createStore<WatchlistState>()((set, get) => {
    type Snapshot = Pick<WatchlistState, 'watchlists' | 'itemsByList'>;

    /**
     * Applies `change` locally, runs `write`, and restores the previous lists/items on failure.
     * Watchlist edits are rare and small, so a whole-state rollback is enough.
     */
    async function optimistic(
      change: (s: Snapshot) => Partial<Snapshot>,
      write: (repo: WatchlistRepository) => Promise<unknown>,
    ): Promise<boolean> {
      const repo = deps.repo();
      if (!repo) return false;
      const before: Snapshot = { watchlists: get().watchlists, itemsByList: get().itemsByList };
      set((s) => ({ ...change(s), error: null }));
      try {
        await write(repo);
        return true;
      } catch (e) {
        const code = toAppError(e).code;
        set({ ...before, error: code === 'APP_UNEXPECTED' ? 'FS_WRITE_FAILED' : code });
        return false;
      }
    }

    const withItems = (s: Snapshot, listId: string, items: readonly WatchlistItem[]) => ({
      itemsByList: { ...s.itemsByList, [listId]: items },
    });

    return {
      ...empty,

      load: async () => {
        const repo = deps.repo();
        if (!repo) return;
        set({ loadState: 'loading' });
        try {
          const lists = await repo.listWatchlists();
          const items = await Promise.all(lists.items.map((l) => repo.listItems(l.id)));
          const itemsByList: Record<string, WatchlistItem[]> = {};
          let skipped = lists.skipped;
          lists.items.forEach((l, i) => {
            itemsByList[l.id] = items[i]?.items ?? [];
            skipped += items[i]?.skipped ?? 0;
          });
          const watchlists = sorted(lists.items);
          const active = get().activeListId;
          set({
            watchlists,
            itemsByList,
            skipped,
            loadState: 'ready',
            activeListId: watchlists.some((l) => l.id === active) ? active : (watchlists[0]?.id ?? null),
          });
        } catch (e) {
          set({ loadState: 'error', error: toAppError(e).code });
        }
      },

      create: async (name) => {
        const repo = deps.repo();
        const lists = get().watchlists;
        if (!repo || watchlistNameIssue(name, lists)) return null;
        if (lists.length >= WATCHLIST_LIMITS.maxLists) {
          set({ error: 'LIMIT_WATCHLISTS' });
          return null;
        }
        const id = repo.newListId();
        const now = deps.clock.now();
        const sortOrder = lists.reduce((m, l) => Math.max(m, l.sortOrder + 1), 0);
        const list: Watchlist = {
          id,
          schemaVersion: 1,
          name: name.trim(),
          sortOrder,
          createdAt: now,
          updatedAt: now,
        };
        const ok = await optimistic(
          (s) => ({ watchlists: sorted([...s.watchlists, list]), ...withItems(s, id, []) }),
          (r) => r.createWatchlist(id, list.name, sortOrder),
        );
        return ok ? id : null;
      },

      rename: (id, name) => {
        if (watchlistNameIssue(name, get().watchlists, id)) return Promise.resolve(false);
        const now = deps.clock.now();
        return optimistic(
          (s) => ({
            watchlists: s.watchlists.map((l) =>
              l.id === id ? { ...l, name: name.trim(), updatedAt: now } : l,
            ),
          }),
          (r) => r.renameWatchlist(id, name),
        );
      },

      remove: async (id) => {
        if (get().watchlists.length <= 1) return false;
        const ok = await optimistic(
          (s) => {
            const itemsByList = { ...s.itemsByList };
            delete itemsByList[id];
            return { watchlists: s.watchlists.filter((l) => l.id !== id), itemsByList };
          },
          (r) => r.deleteWatchlist(id),
        );
        if (ok && get().activeListId === id) set({ activeListId: get().watchlists[0]?.id ?? null });
        return ok;
      },

      setMembership: async (ref, listIds, template) => {
        const key = toInstrumentKey(ref.exchange, ref.symbol);
        const s = get();
        const want = new Set(listIds);
        const has = (id: string) => (s.itemsByList[id] ?? []).some((i) => itemKey(i) === key);
        const add = s.watchlists.filter((l) => want.has(l.id) && !has(l.id)).map((l) => l.id);
        const drop = s.watchlists.filter((l) => !want.has(l.id) && has(l.id)).map((l) => l.id);
        if (add.length === 0 && drop.length === 0) return true;
        if (add.some((id) => (s.itemsByList[id]?.length ?? 0) >= WATCHLIST_LIMITS.maxItemsPerList)) {
          set({ error: 'LIMIT_WATCHLIST_ITEMS' });
          return false;
        }
        const now = deps.clock.now();
        const fields: NewWatchlistItem = NewWatchlistItemSchema.parse({
          symbol: ref.symbol,
          exchange: ref.exchange,
          targetEntryPrice: template?.targetEntryPrice ?? null,
          targetExitPrice: template?.targetExitPrice ?? null,
          notes: template?.notes ?? null,
        });
        const item: WatchlistItem = { schemaVersion: 1, ...fields, addedAt: now, updatedAt: now };
        return optimistic(
          (st) => {
            const itemsByList = { ...st.itemsByList };
            for (const id of add) itemsByList[id] = [...(itemsByList[id] ?? []), item];
            for (const id of drop)
              itemsByList[id] = (itemsByList[id] ?? []).filter((i) => itemKey(i) !== key);
            return { itemsByList };
          },
          (r) =>
            Promise.all([
              ...add.map((id) => r.upsertItem(id, fields)),
              ...drop.map((id) => r.removeItem(id, key)),
            ]),
        );
      },

      updateItem: (listId, key, patch) => {
        const current = (get().itemsByList[listId] ?? []).find((i) => itemKey(i) === key);
        if (!current) return Promise.resolve(false);
        const parsed = NewWatchlistItemSchema.safeParse({
          symbol: current.symbol,
          exchange: current.exchange,
          ...patch,
        });
        if (!parsed.success) return Promise.resolve(false);
        const now = deps.clock.now();
        return optimistic(
          (s) =>
            withItems(
              s,
              listId,
              (s.itemsByList[listId] ?? []).map((i) =>
                itemKey(i) === key ? { ...i, ...parsed.data, updatedAt: now } : i,
              ),
            ),
          (r) => r.upsertItem(listId, parsed.data, { exists: true }),
        );
      },

      removeItem: (listId, key) =>
        optimistic(
          (s) =>
            withItems(
              s,
              listId,
              (s.itemsByList[listId] ?? []).filter((i) => itemKey(i) !== key),
            ),
          (r) => r.removeItem(listId, key),
        ),

      setActive: (id) => {
        if (get().watchlists.some((l) => l.id === id)) set({ activeListId: id });
      },

      clearError: () => set({ error: null }),

      reset: () => set(empty),
    };
  });
}
