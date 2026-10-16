import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-portfolio',
    firestore: { rules: readFileSync(join(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

const ts = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

const profile = {
  schemaVersion: 1,
  displayName: 'Alice',
  email: 'alice@example.com',
  authProvider: 'google',
  settings: { summaryCurrency: 'INR', defaultSort: 'VALUE_DESC', aiSuggestions: true },
  platforms: [],
  sectorOverrides: {},
  ...ts,
};

const buy = {
  schemaVersion: 1,
  type: 'BUY',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  name: 'Reliance Industries Ltd',
  platform: 'Zerodha',
  quantity: 10,
  price: 2450.5,
  tradeDate: '2024-03-15',
  source: 'CSV',
  importBatchId: 'b1',
  ...ts,
};

const watchlist = { schemaVersion: 1, name: 'My Watchlist', sortOrder: 0, ...ts };
const item = {
  schemaVersion: 1,
  symbol: 'NVDA',
  exchange: 'NASDAQ',
  targetEntryPrice: 128,
  targetExitPrice: null,
  notes: null,
  addedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

const rule = {
  schemaVersion: 1,
  name: 'Oversold',
  naturalPrompt: 'RSI below 30',
  compiledLogicJson: '{"<":[{"var":"rsi14"},30]}',
  readBack: 'RSI (14) is below 30',
  variables: ['rsi14'],
  appliesToPortfolio: true,
  appliesToWatchlists: false,
  enabled: true,
  compiledWith: { model: 'gemini-3.5-flash', promptVersion: 'rule-compile@1' },
  ...ts,
};

const result = {
  schemaVersion: 1,
  ruleId: 'r1',
  sessionDate: '2026-10-15',
  matches: [{ instrumentKey: 'NSE:INFY', scope: 'PORTFOLIO' }],
  evaluatedAt: serverTimestamp(),
};

describe('users/{uid}', () => {
  it('lets the owner create, read, update and delete their profile', async () => {
    const ref = doc(alice(), 'users/alice');
    await assertSucceeds(setDoc(ref, profile));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { displayName: 'Alice B', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('denies other users and signed-out users', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users/alice'), profile));
    await assertFails(getDoc(doc(bob(), 'users/alice')));
    await assertFails(setDoc(doc(bob(), 'users/alice'), profile));
    await assertFails(getDoc(doc(anon(), 'users/alice')));
  });

  it('rejects extra fields, a wrong schema version and too many platforms', async () => {
    const ref = doc(alice(), 'users/alice');
    await assertFails(setDoc(ref, { ...profile, isAdmin: true }));
    await assertFails(setDoc(ref, { ...profile, schemaVersion: 2 }));
    await assertFails(setDoc(ref, { ...profile, platforms: Array.from({ length: 31 }, (_, i) => `P${i}`) }));
    await assertFails(setDoc(ref, { ...profile, authProvider: 'apple' }));
  });
});

describe('transactions', () => {
  const path = 'users/alice/transactions/t1';

  it('allows a valid BUY for the owner only', async () => {
    await assertSucceeds(setDoc(doc(alice(), path), buy));
    await assertFails(getDoc(doc(bob(), path)));
    await assertFails(setDoc(doc(bob(), 'users/alice/transactions/t2'), buy));
  });

  it.each([
    ['SELL type', { type: 'SELL' }],
    ['unknown exchange', { exchange: 'LSE' }],
    ['zero quantity', { quantity: 0 }],
    ['negative price', { price: -1 }],
    ['bad date', { tradeDate: '15/03/2024' }],
    ['unknown source', { source: 'API' }],
    ['long platform', { platform: 'x'.repeat(41) }],
    ['extra field', { notes: 'hi' }],
  ])('rejects %s', async (_label, patch) => {
    await assertFails(setDoc(doc(alice(), path), { ...buy, ...patch }));
  });
});

describe('watchlists and items', () => {
  it('allows the owner to manage watchlists and items keyed by instrument', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/watchlists/w1'), watchlist));
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/watchlists/w1/items/NASDAQ:NVDA'), item));
    await assertSucceeds(deleteDoc(doc(alice(), 'users/alice/watchlists/w1/items/NASDAQ:NVDA')));
    await assertFails(getDoc(doc(bob(), 'users/alice/watchlists/w1')));
  });

  it('rejects an item whose ID is not exchange:symbol, and long names', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/watchlists/w1/items/NVDA'), item));
    await assertFails(
      setDoc(doc(alice(), 'users/alice/watchlists/w1'), { ...watchlist, name: 'x'.repeat(41) }),
    );
  });
});

describe('rules and results', () => {
  it('allows a valid rule and rejects one with both scopes off', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/rules/r1'), rule));
    await assertFails(
      setDoc(doc(alice(), 'users/alice/rules/r2'), {
        ...rule,
        appliesToPortfolio: false,
        appliesToWatchlists: false,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), 'users/alice/rules/r3'), { ...rule, compiledLogicJson: 'x'.repeat(10001) }),
    );
  });

  it('requires result IDs of {sessionDate}_{ruleId}', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/ruleResults/2026-10-15_r1'), result));
    await assertFails(setDoc(doc(alice(), 'users/alice/ruleResults/whatever'), result));
    await assertFails(
      setDoc(doc(alice(), 'users/alice/ruleResults/2026-10-15_r1'), { ...result, matches: 'all' }),
    );
  });
});

describe('reference/**', () => {
  it('is readable when signed in and never writable from clients', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'reference/instruments'), { version: '2026-10-15.1' }),
    );
    await assertSucceeds(getDoc(doc(alice(), 'reference/instruments')));
    await assertFails(getDoc(doc(anon(), 'reference/instruments')));
    await assertFails(setDoc(doc(alice(), 'reference/instruments'), { version: 'evil' }));
    await assertFails(setDoc(doc(alice(), 'reference/instruments/chunks/x'), { tsv: '' }));
  });

  it('denies unknown top-level collections', async () => {
    await assertFails(setDoc(doc(alice(), 'public/anything'), { a: 1 }));
  });
});
