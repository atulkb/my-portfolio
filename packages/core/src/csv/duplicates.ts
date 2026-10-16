import { normalisePlatform, type Exchange, type IsoDate } from '../models/primitives';
import type { BuyTransaction, NewBuyTransaction } from '../models/transaction';

/** Buys that look identical (stock, exchange, platform, date, quantity). Informational only (HLD D31). */
export type DuplicateGroup = {
  readonly symbol: string;
  readonly exchange: Exchange;
  readonly platform: string;
  readonly tradeDate: IsoDate;
  readonly quantity: number;
  /** Indexes into the incoming list. */
  readonly incoming: readonly number[];
  readonly existingIds: readonly string[];
};

type Keyed = Pick<NewBuyTransaction, 'symbol' | 'exchange' | 'platform' | 'tradeDate' | 'quantity'>;

const keyOf = (t: Keyed): string =>
  [t.symbol, t.exchange, normalisePlatform(t.platform), t.tradeDate, String(t.quantity)].join('|');

/**
 * Flags incoming buys that match an existing buy, or each other, on symbol + exchange +
 * platform (case-insensitive) + trade date + quantity. Used only for the non-blocking
 * post-import heads-up and the manual-add warning; nothing is rejected (HLD D31).
 */
export function findLikelyDuplicates(
  incoming: readonly Keyed[],
  existing: readonly BuyTransaction[],
): DuplicateGroup[] {
  const existingByKey = new Map<string, string[]>();
  for (const tx of existing) {
    const k = keyOf(tx);
    const list = existingByKey.get(k);
    if (list) list.push(tx.id);
    else existingByKey.set(k, [tx.id]);
  }
  const incomingByKey = new Map<string, number[]>();
  incoming.forEach((tx, i) => {
    const k = keyOf(tx);
    const list = incomingByKey.get(k);
    if (list) list.push(i);
    else incomingByKey.set(k, [i]);
  });
  const groups: DuplicateGroup[] = [];
  for (const [k, idx] of incomingByKey) {
    const existingIds = existingByKey.get(k) ?? [];
    if (existingIds.length === 0 && idx.length < 2) continue;
    const first = incoming[idx[0] as number] as Keyed;
    groups.push({
      symbol: first.symbol,
      exchange: first.exchange,
      platform: first.platform,
      tradeDate: first.tradeDate,
      quantity: first.quantity,
      incoming: idx,
      existingIds,
    });
  }
  return groups;
}
