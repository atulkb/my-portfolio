import { z } from 'zod';
import { ExchangeSchema, SymbolSchema } from './primitives';

/** App-enforced limits (LLD §1.6). */
export const WATCHLIST_LIMITS = { maxLists: 20, maxItemsPerList: 100 } as const;

/** Name of the watchlist created on first sign-in. */
export const DEFAULT_WATCHLIST_NAME = 'My Watchlist';

/** `users/{uid}/watchlists/{watchlistId}`. Name is editable and unique per user (case-insensitive, checked in app). */
export const WatchlistSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(40),
  sortOrder: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});
/** Watchlist with its document ID. */
export type Watchlist = z.infer<typeof WatchlistSchema> & { id: string };

const itemFields = {
  symbol: SymbolSchema,
  exchange: ExchangeSchema,
  targetEntryPrice: z.number().positive().nullable(),
  targetExitPrice: z.number().positive().nullable(),
  notes: z.string().max(500).nullable(),
};

/** `users/{uid}/watchlists/{watchlistId}/items/{instrumentKey}`. */
export const WatchlistItemSchema = z.object({
  schemaVersion: z.literal(1),
  ...itemFields,
  addedAt: z.number(),
  updatedAt: z.number(),
});
/** Watchlist item; its document ID is the instrument key, so a stock appears at most once per list. */
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;

/** Input for adding or updating a watchlist item. */
export const NewWatchlistItemSchema = z.object(itemFields);
/** Input for adding or updating a watchlist item. */
export type NewWatchlistItem = z.infer<typeof NewWatchlistItemSchema>;
