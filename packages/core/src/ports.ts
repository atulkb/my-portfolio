/**
 * Interfaces implemented by the app's service layer (LLD §1.10, §3.1). Domain code and tests
 * depend on these, never on an SDK.
 */
import type { z } from 'zod';
import type {
  BarsRequest,
  BarsResult,
  Capability,
  Fundamentals,
  InstrumentProfile,
  InstrumentRef,
  LatestCloseResult,
} from './market/types';
import type { InstrumentChunk, InstrumentMasterMeta } from './models/instrument';
import type { EpochMs, Exchange, InstrumentKey, IsoDate } from './models/primitives';
import type { NewRule, Rule, RulePatch, RuleResult } from './models/rule';
import type { BuyTransaction, BuyTransactionPatch, NewBuyTransaction } from './models/transaction';
import type { ProfileSeed, UserProfile, UserSettings } from './models/user';
import type { NewWatchlistItem, Watchlist, WatchlistItem } from './models/watchlist';

/** Result of reading a collection: invalid documents are skipped and counted, never thrown (LLD §3.7). */
export type ReadResult<T> = { readonly items: T[]; readonly skipped: number };

/** `users/{uid}/transactions`. */
export interface TransactionRepository {
  /** Creates `n` new document IDs locally (no network), so optimistic adds use their real IDs. */
  newIds(n: number): string[];
  /** Whole subcollection (≤ 500 docs). */
  listAll(): Promise<ReadResult<BuyTransaction>>;
  /** Batched writes (≤ 500 per batch) under the given IDs (from {@link newIds}). */
  addMany(
    items: readonly { readonly id: string; readonly tx: NewBuyTransaction }[],
    importBatchId: string | null,
  ): Promise<void>;
  /** Undo import; returns the number of documents deleted. */
  deleteByImportBatch(importBatchId: string): Promise<number>;
  update(id: string, patch: BuyTransactionPatch): Promise<void>;
  /** Remove stock / remove from broker. */
  deleteMany(ids: string[]): Promise<void>;
  /** Case-insensitive rename; returns documents updated. */
  renamePlatform(from: string, to: string): Promise<number>;
}

/** `users/{uid}/watchlists` and their items. */
export interface WatchlistRepository {
  listWatchlists(): Promise<ReadResult<Watchlist>>;
  createWatchlist(name: string): Promise<string>;
  renameWatchlist(id: string, name: string): Promise<void>;
  /** Deletes the items first. */
  deleteWatchlist(id: string): Promise<void>;
  listItems(watchlistId: string): Promise<ReadResult<WatchlistItem>>;
  /** Document ID = instrument key. */
  upsertItem(watchlistId: string, item: NewWatchlistItem): Promise<void>;
  removeItem(watchlistId: string, key: InstrumentKey): Promise<void>;
}

/** `users/{uid}/rules` and `ruleResults`. */
export interface RuleRepository {
  list(): Promise<ReadResult<Rule>>;
  create(rule: NewRule): Promise<string>;
  update(id: string, patch: RulePatch): Promise<void>;
  delete(id: string): Promise<void>;
  saveResults(results: RuleResult[]): Promise<void>;
  listResults(sessionDate: IsoDate): Promise<ReadResult<RuleResult>>;
  pruneResultsBefore(date: IsoDate): Promise<void>;
}

/** `users/{uid}` profile document. */
export interface ProfileRepository {
  get(): Promise<UserProfile | null>;
  /** First sign-in: profile + default watchlist, idempotent. */
  createIfMissing(seed: ProfileSeed): Promise<UserProfile>;
  updateSettings(patch: Partial<UserSettings>): Promise<void>;
  setPlatforms(platforms: string[]): Promise<void>;
  setSectorOverride(key: InstrumentKey, sector: string | null): Promise<void>;
  /** Deletes every user document (LLD §1.12). */
  deleteAccountData(): Promise<void>;
}

/** Read-only `reference/instruments`. */
export interface InstrumentMasterRepository {
  getMeta(): Promise<InstrumentMasterMeta | null>;
  getChunks(meta: InstrumentMasterMeta): Promise<InstrumentChunk[]>;
}

/** Time source, injected so domain code never reads the clock. */
export interface Clock {
  now(): EpochMs;
}

/** Local key-value cache (MMKV in the app, in-memory in tests). */
export interface KeyValueCache {
  /** Returns `null` when missing; a value failing `schema` is deleted and `null` returned. */
  get<T>(key: string, schema: z.ZodType<T>): T | null;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(prefix: string): string[];
}

/** One market-data provider adapter (LLD §3.3). */
export interface MarketDataProvider {
  readonly id: 'yahoo' | 'twelvedata' | 'finnhub' | 'quotepage';
  supports(cap: Capability, exchange: Exchange | null): boolean;
  getDailyBars?(req: BarsRequest): Promise<BarsResult>;
  getLatestClose?(ref: InstrumentRef): Promise<LatestCloseResult>;
  getFundamentals?(ref: InstrumentRef): Promise<Fundamentals>;
  getProfile?(ref: InstrumentRef): Promise<InstrumentProfile>;
}
