import { AppError, type Watchlist, type WatchlistItem, type WatchlistRepository } from '@portfolio/core';

import { allWatchedKeys, createWatchlistStore, watchlistNameIssue } from './watchlistStore';

const list = (id: string, name: string, sortOrder: number): Watchlist => ({
  id,
  name,
  sortOrder,
  schemaVersion: 1,
  createdAt: sortOrder,
  updatedAt: sortOrder,
});

const item = (symbol: string, over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  schemaVersion: 1,
  symbol,
  exchange: 'NSE',
  targetEntryPrice: null,
  targetExitPrice: null,
  notes: null,
  addedAt: 1,
  updatedAt: 1,
  ...over,
});

function setup(
  lists: Watchlist[] = [list('b', 'Tech', 1), list('a', 'My Watchlist', 0)],
  items: Record<string, WatchlistItem[]> = { a: [item('INFY')], b: [] },
) {
  let n = 0;
  const repo = {
    listWatchlists: jest.fn(async () => ({ items: lists, skipped: 0 })),
    newListId: () => `new${++n}`,
    createWatchlist: jest.fn(async () => undefined),
    renameWatchlist: jest.fn(async () => undefined),
    deleteWatchlist: jest.fn(async () => undefined),
    listItems: jest.fn(async (id: string) => ({ items: items[id] ?? [], skipped: id === 'b' ? 1 : 0 })),
    upsertItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  } satisfies WatchlistRepository;
  const store = createWatchlistStore({ repo: () => repo, clock: { now: () => 5 } });
  return { store, repo };
}

describe('watchlistStore', () => {
  it('loads lists sorted with their items and picks the first as active', async () => {
    const { store } = setup();
    await store.getState().load();
    const s = store.getState();
    expect(s.loadState).toBe('ready');
    expect(s.watchlists.map((l) => l.id)).toEqual(['a', 'b']);
    expect(s.activeListId).toBe('a');
    expect(s.skipped).toBe(1);
    expect(allWatchedKeys(s)).toEqual(['NSE:INFY']);
  });

  it('validates names: required, unique ignoring case, at most 40 characters', () => {
    const lists = [list('a', 'My Watchlist', 0)];
    expect(watchlistNameIssue('  ', lists)).toMatch(/Enter a name/);
    expect(watchlistNameIssue('my watchlist', lists)).toMatch(/already/);
    expect(watchlistNameIssue('my watchlist', lists, 'a')).toBeNull();
    expect(watchlistNameIssue('x'.repeat(41), lists)).toMatch(/40/);
    expect(watchlistNameIssue('Dividend', lists)).toBeNull();
  });

  it('creates a list optimistically after the last one', async () => {
    const { store, repo } = setup();
    await store.getState().load();
    const id = await store.getState().create(' Dividend ');
    expect(id).toBe('new1');
    expect(repo.createWatchlist).toHaveBeenCalledWith('new1', 'Dividend', 2);
    expect(store.getState().watchlists.map((l) => l.name)).toEqual(['My Watchlist', 'Tech', 'Dividend']);
    expect(store.getState().itemsByList['new1']).toEqual([]);
    expect(await store.getState().create('tech')).toBeNull();
  });

  it('enforces the 20-list limit', async () => {
    const many = Array.from({ length: 20 }, (_, i) => list(`l${i}`, `List ${i}`, i));
    const { store, repo } = setup(many, {});
    await store.getState().load();
    expect(await store.getState().create('One more')).toBeNull();
    expect(store.getState().error).toBe('LIMIT_WATCHLISTS');
    expect(repo.createWatchlist).not.toHaveBeenCalled();
  });

  it('rolls back a failed rename and reports the error', async () => {
    const { store, repo } = setup();
    await store.getState().load();
    repo.renameWatchlist.mockRejectedValueOnce(new AppError('FS_UNAVAILABLE'));
    expect(await store.getState().rename('b', 'Growth')).toBe(false);
    expect(store.getState().watchlists.find((l) => l.id === 'b')?.name).toBe('Tech');
    expect(store.getState().error).toBe('FS_UNAVAILABLE');
  });

  it('never deletes the last list and moves the active list on delete', async () => {
    const { store, repo } = setup();
    await store.getState().load();
    store.getState().setActive('b');
    expect(await store.getState().remove('b')).toBe(true);
    expect(repo.deleteWatchlist).toHaveBeenCalledWith('b');
    expect(store.getState().activeListId).toBe('a');
    expect(await store.getState().remove('a')).toBe(false);
  });

  it('sets membership: adds to missing lists, removes from unchecked ones, keeps a template', async () => {
    const { store, repo } = setup();
    await store.getState().load();
    const ok = await store.getState().setMembership({ exchange: 'NSE', symbol: 'INFY' }, ['b'], {
      targetEntryPrice: 1400,
      targetExitPrice: null,
      notes: 'dip',
    });
    expect(ok).toBe(true);
    expect(repo.upsertItem).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ symbol: 'INFY', targetEntryPrice: 1400, notes: 'dip' }),
    );
    expect(repo.removeItem).toHaveBeenCalledWith('a', 'NSE:INFY');
    expect(store.getState().itemsByList['a']).toEqual([]);
    expect(store.getState().itemsByList['b']?.[0]?.targetEntryPrice).toBe(1400);
  });

  it('enforces 100 stocks per list', async () => {
    const full = Array.from({ length: 100 }, (_, i) => item(`S${i}`));
    const { store, repo } = setup([list('a', 'Full', 0)], { a: full });
    await store.getState().load();
    expect(await store.getState().setMembership({ exchange: 'NSE', symbol: 'TCS' }, ['a'])).toBe(false);
    expect(store.getState().error).toBe('LIMIT_WATCHLIST_ITEMS');
    expect(repo.upsertItem).not.toHaveBeenCalled();
  });

  it('updates targets in place (keeping addedAt) and rejects invalid prices', async () => {
    const { store, repo } = setup();
    await store.getState().load();
    const patch = { targetEntryPrice: 1400, targetExitPrice: 1900, notes: null };
    expect(await store.getState().updateItem('a', 'NSE:INFY', patch)).toBe(true);
    expect(repo.upsertItem).toHaveBeenCalledWith('a', expect.objectContaining(patch), { exists: true });
    expect(store.getState().itemsByList['a']?.[0]).toMatchObject({ ...patch, addedAt: 1, updatedAt: 5 });
    expect(await store.getState().updateItem('a', 'NSE:INFY', { ...patch, targetEntryPrice: -1 })).toBe(
      false,
    );
  });
});
