import { z } from 'zod';
import {
  EXCHANGE_META,
  ExchangeSchema,
  IsoDateSchema,
  MIN_TRADE_DATE,
  PlatformSchema,
  SymbolSchema,
  type Exchange,
  type IsoDate,
} from './primitives';

/** v1 stores BUY only. Later: 'SELL', 'DIVIDEND', 'SPLIT' in the same collection (no migration, HLD D30). */
export const TransactionTypeSchema = z.enum(['BUY']);
export const TransactionSourceSchema = z.enum(['CSV', 'MANUAL']);

const editableFields = {
  platform: PlatformSchema,
  quantity: z.number().positive().max(1e9),
  /** Per share, native currency. Never rounded when stored. */
  price: z.number().positive().max(1e7),
  tradeDate: IsoDateSchema,
};

const newFields = {
  type: TransactionTypeSchema,
  symbol: SymbolSchema,
  exchange: ExchangeSchema,
  /** Display snapshot; the master-list name is preferred at render time. */
  name: z.string().trim().min(1).max(120),
  ...editableFields,
  source: TransactionSourceSchema,
};

type BuyCheckInput = { exchange: Exchange; quantity: number; tradeDate: IsoDate };

/** Business rules shared by every buy schema. `today` is optional so stored docs never fail on clock skew. */
function checkBuy(tx: BuyCheckInput, ctx: z.RefinementCtx, today?: IsoDate): void {
  if (EXCHANGE_META[tx.exchange].market === 'IN' && !Number.isInteger(tx.quantity)) {
    ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Indian shares must be whole numbers' });
  }
  if (tx.tradeDate < MIN_TRADE_DATE || (today !== undefined && tx.tradeDate > today)) {
    ctx.addIssue({ code: 'custom', path: ['tradeDate'], message: 'Trade date out of range' });
  }
}

/** `users/{uid}/transactions/{txId}` document as stored (LLD §1.5). */
export const BuyTransactionSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...newFields,
    /** Groups rows from one CSV upload (Undo import); null for manual buys. */
    importBatchId: z.string().min(1).max(64).nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .superRefine((tx, ctx) => checkBuy(tx, ctx));
/** Stored buy document fields. */
export type BuyTransactionDoc = z.infer<typeof BuyTransactionSchema>;
/** Buy transaction with its Firestore document ID. */
export type BuyTransaction = BuyTransactionDoc & { id: string };

/**
 * Schema for a buy about to be written. `today` is the device's local date and is passed in
 * so this module stays pure (no clock access in core).
 */
export function newBuyTransactionSchema(today: IsoDate) {
  return z.object(newFields).superRefine((tx, ctx) => checkBuy(tx, ctx, today));
}
/** Input for creating a buy (no ID, timestamps or batch ID; those are added by the repository). */
export type NewBuyTransaction = z.infer<ReturnType<typeof newBuyTransactionSchema>>;

/** Fields the user may edit on an existing buy (HLD §16 Edit). Validated after merging with the stored doc. */
export type BuyTransactionPatch = Partial<Pick<BuyTransactionDoc, keyof typeof editableFields>>;

/** Validates an existing buy after applying a patch. */
export function applyBuyPatch(
  current: BuyTransactionDoc,
  patch: BuyTransactionPatch,
  today: IsoDate,
): z.ZodSafeParseResult<NewBuyTransaction> {
  const { type, symbol, exchange, name, platform, quantity, price, tradeDate, source } = {
    ...current,
    ...patch,
  };
  return newBuyTransactionSchema(today).safeParse({
    type,
    symbol,
    exchange,
    name,
    platform,
    quantity,
    price,
    tradeDate,
    source,
  });
}
