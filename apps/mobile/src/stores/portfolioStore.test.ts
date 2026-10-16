import {
  AppError,
  type BuyTransaction,
  type NewBuyTransaction,
  type TransactionRepository,
} from '@portfolio/core';

import { createKeyValueCache, memoryRawStore } from '@/services/cache/kv';
import { createPortfolioStore, UNDO_IMPORT_WINDOW_MS } from './portfolioStore';

const buy = (over: Partial<NewBuyTransaction> = {}): NewBuyTransaction => ({
  type: 'BUY',
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys Ltd',
  platform: 'Zerodha',
  quantity: 10,
  price: 1500,
  tradeDate: '2024-03-15',
  source: 'MANUAL',
  ...over,
});

const stored = (id: string, over: Partial<BuyTransaction> = {}): BuyTransaction => ({
  ...buy(),
  id,
  schemaVersion: 1,
  importBatchId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

type Gate = { release: () => void; fail: (e: unknown) => void };

function setup(initial: BuyTransaction[] = []) {
  let n = 0;
  const gates: Gate[] = [];
  /** Each write waits until the test releases or fails it. */
  const pendingWrite = (): Promise<void> =>
    new Promise<void>((resolve, reject) => gates.push({ release: resolve, fail: reject }));
  const repo = {
    newIds: (count: number) => Array.from({ length: count }, () => `id${++n}`),
    listAll: jest.fn(async () => ({ items: initial, skipped: 1 })),
    addMany: jest.fn(pendingWrite),
    deleteByImportBatch: jest.fn(async () => {
      await pendingWrite();
      return 0;
    }),
    update: jest.fn(pendingWrite),
    deleteMany: jest.fn(pendingWrite),
    renamePlatform: jest.fn(async () => 0),
  } satisfies TransactionRepository;
  const raw = memoryRawStore();
  let now = 1_000;
  const store = createPortfolioStore({
    repo: () => repo,
    kv: createKeyValueCache(raw),
    clock: { now: () => now },
    today: () => '2026-10-16',
    newBatchId: () => 'batch-1',
  });
  const settle = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
  };
  return { store, repo, gates, raw, settle, advance: (ms: number) => (now += ms) };
}

describe('portfolioStore', () => {
  it('loads transactions and counts skipped documents', async () => {
    const { store } = setup([stored('a')]);
    await store.getState().load();
    expect(store.getState().loadState).toBe('ready');
    expect(store.getState().transactions).toHaveLength(1);
    expect(store.getState().skipped).toBe(1);
  });

  it('adds optimistically with the real id and tracks the pending write', async () => {
    const { store, repo, gates, settle } = setup();
    const p = store.getState().addBuy(buy());
    expect(store.getState().transactions.map((t) => t.id)).toEqual(['id1']);
    expect(store.getState().pendingWrites).toBe(1);
    gates[0]?.release();
    expect(await p).toBe(true);
    await settle();
    expect(store.getState().pendingWrites).toBe(0);
    expect(repo.addMany).toHaveBeenCalledWith([{ id: 'id1', tx: buy() }], null);
  });

  it('rejects invalid buys without writing', async () => {
    const { store, repo } = setup();
    expect(await store.getState().addBuy(buy({ quantity: 1.5 }))).toBe(false); // fractional India
    expect(await store.getState().addBuy(buy({ tradeDate: '2026-10-17' }))).toBe(false); // future
    expect(repo.addMany).not.toHaveBeenCalled();
  });

  it('rolls back a failed add but keeps other changes', async () => {
    const { store, gates } = setup();
    const first = store.getState().addBuy(buy());
    const second = store.getState().addBuy(buy({ symbol: 'TCS', name: 'TCS' }));
    gates[0]?.fail(new AppError('FS_PERMISSION'));
    gates[1]?.release();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(store.getState().transactions.map((t) => t.symbol)).toEqual(['TCS']);
    expect(store.getState().error).toBe('FS_PERMISSION');
  });

  it('updates a buy and restores it when the write fails', async () => {
    const { store, gates } = setup([stored('a')]);
    await store.getState().load();
    const p = store.getState().updateBuy('a', { price: 1600 });
    expect(store.getState().transactions[0]?.price).toBe(1600);
    gates[0]?.fail(new Error('boom'));
    expect(await p).toBe(false);
    expect(store.getState().transactions[0]?.price).toBe(1500);
    expect(store.getState().error).toBe('FS_WRITE_FAILED');
  });

  it('removes a holding, or only one broker’s buys', async () => {
    const { store, repo, gates } = setup([
      stored('a'),
      stored('b', { platform: 'groww' }),
      stored('c', { symbol: 'TCS', name: 'TCS' }),
    ]);
    await store.getState().load();
    const p1 = store.getState().removeFromBroker('NSE:INFY', 'Groww');
    gates[0]?.release();
    await p1;
    expect(repo.deleteMany).toHaveBeenLastCalledWith(['b']);
    const p2 = store.getState().removeHolding('NSE:INFY');
    gates[1]?.release();
    await p2;
    expect(store.getState().transactions.map((t) => t.id)).toEqual(['c']);
  });

  it('imports a CSV batch, remembers it, and undoes it', async () => {
    const { store, repo, gates, raw } = setup([stored('a')]);
    await store.getState().load();
    const p = store.getState().importCsv([buy({ source: 'CSV' }), buy({ source: 'CSV', quantity: 5 })]);
    gates[0]?.release();
    expect(await p).toBe(true);
    expect(repo.addMany).toHaveBeenCalledWith(expect.any(Array), 'batch-1');
    expect(store.getState().lastImport).toEqual({ importBatchId: 'batch-1', importedAt: 1_000, count: 2 });
    expect(raw.data.has('import.lastBatch')).toBe(true);

    const u = store.getState().undoLastImport();
    expect(store.getState().transactions.map((t) => t.id)).toEqual(['a']);
    await new Promise((r) => setTimeout(r, 0));
    gates[1]?.release();
    expect(await u).toBe(true);
    expect(store.getState().lastImport).toBeNull();
    expect(raw.data.has('import.lastBatch')).toBe(false);
  });

  it('forgets the last import after 7 days', async () => {
    const { store, gates, advance } = setup();
    const p = store.getState().importCsv([buy({ source: 'CSV' })]);
    gates[0]?.release();
    await p;
    advance(UNDO_IMPORT_WINDOW_MS + 1);
    await store.getState().load();
    expect(store.getState().lastImport).toBeNull();
  });

  it('reset clears everything', async () => {
    const { store } = setup([stored('a')]);
    await store.getState().load();
    store.getState().reset();
    expect(store.getState().transactions).toEqual([]);
    expect(store.getState().loadState).toBe('idle');
  });
});
