import { EXCHANGE_META, normalisePlatform, toInstrumentKey, type InstrumentKey } from '../models/primitives';
import type { BuyTransaction } from '../models/transaction';
import { daysBetween, minDate } from '../util/dates';
import { pctChange } from '../util/numbers';
import { convert } from './fx';
import type {
  BrokerPosition,
  LabelFilter,
  PortfolioFilters,
  PortfolioSort,
  PricingContext,
  StockHolding,
} from './types';
import { UNCLASSIFIED_SECTOR } from './types';
import { xirr } from './xirr';

function matchesTransactionFilters(
  tx: BuyTransaction,
  f: PortfolioFilters,
  platforms: ReadonlySet<string>,
): boolean {
  if (platforms.size > 0 && !platforms.has(normalisePlatform(tx.platform))) return false;
  if (f.markets.length > 0 && !f.markets.includes(EXCHANGE_META[tx.exchange].market)) return false;
  if (f.exchanges.length > 0 && !f.exchanges.includes(tx.exchange)) return false;
  return true;
}

const labelMatches = (label: StockHolding['performance'], wanted: readonly LabelFilter[]): boolean =>
  wanted.length === 0 || wanted.includes(label ?? 'NONE');

function matchesHoldingFilters(h: StockHolding, f: PortfolioFilters): boolean {
  if (f.sectors.length > 0) {
    const sector = h.sector ?? UNCLASSIFIED_SECTOR;
    if (!f.sectors.includes(sector)) return false;
  }
  return labelMatches(h.performance, f.performance) && labelMatches(h.health, f.health);
}

function brokersOf(txs: readonly BuyTransaction[]): BrokerPosition[] {
  const groups = new Map<string, BuyTransaction[]>();
  for (const tx of txs) {
    const k = normalisePlatform(tx.platform);
    const list = groups.get(k);
    if (list) list.push(tx);
    else groups.set(k, [tx]);
  }
  return [...groups.values()]
    .map((buys) => {
      const sorted = [...buys].sort((a, b) =>
        a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0,
      );
      const quantity = sorted.reduce((s, b) => s + b.quantity, 0);
      const invested = sorted.reduce((s, b) => s + b.quantity * b.price, 0);
      return {
        platform: sorted[0]?.platform ?? '',
        quantity,
        invested,
        avgPrice: invested / quantity,
        buys: sorted,
      };
    })
    .sort((a, b) => b.invested - a.invested);
}

function buildHolding(key: InstrumentKey, txs: readonly BuyTransaction[], ctx: PricingContext): StockHolding {
  const first = txs[0] as BuyTransaction; // caller guarantees ≥ 1 transaction per group
  const { market, currency } = EXCHANGE_META[first.exchange];
  const quantity = txs.reduce((s, t) => s + t.quantity, 0);
  const invested = txs.reduce((s, t) => s + t.quantity * t.price, 0);
  const latestName = [...txs].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.name ?? first.name;

  const snap = ctx.snapshots.get(key);
  const close = snap?.close ?? null;
  const prevClose = snap?.prevClose ?? null;
  const value = close === null ? null : quantity * close;
  const pnl = value === null ? null : value - invested;
  const ageDate = snap?.sessionDate ?? ctx.valuationDate;
  const holdingDays =
    txs.reduce((s, t) => s + t.quantity * Math.max(0, daysBetween(t.tradeDate, ageDate)), 0) / quantity;

  let xirrPct: number | null = null;
  if (snap && value !== null) {
    const r = xirr([
      ...txs.map((t) => ({ date: t.tradeDate, amount: -t.quantity * t.price })),
      { date: snap.sessionDate, amount: value },
    ]);
    xirrPct = r === null ? null : r * 100;
  }

  const labels = ctx.labels.get(key);
  return {
    key,
    symbol: first.symbol,
    exchange: first.exchange,
    name: latestName,
    market,
    currency,
    sector: ctx.sectorOf(key),
    quantity,
    avgPrice: invested / quantity,
    invested,
    close,
    value,
    pnl,
    pnlPct: pnl === null ? null : (pnl / invested) * 100,
    dayChange: close === null || prevClose === null ? null : quantity * (close - prevClose),
    dayChangePct: pctChange(prevClose, close),
    xirrPct,
    holdingDays,
    firstBuyDate: minDate(txs.map((t) => t.tradeDate)) ?? first.tradeDate,
    priceDate: snap?.sessionDate ?? null,
    brokers: brokersOf(txs),
    performance: labels?.performance ?? null,
    health: labels?.health ?? null,
  };
}

/** Compares nullable numbers descending with nulls last. */
function desc(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

/** Sorts holdings; value-based sorts compare across currencies in INR. Name breaks ties. */
export function sortHoldings(
  holdings: readonly StockHolding[],
  sort: PortfolioSort,
  usdInr: number,
): StockHolding[] {
  const inInr = (h: StockHolding): number | null =>
    h.value === null ? null : convert(h.value, h.currency, 'INR', usdInr);
  const byName = (a: StockHolding, b: StockHolding): number => a.name.localeCompare(b.name);
  const cmp: Record<PortfolioSort, (a: StockHolding, b: StockHolding) => number> = {
    VALUE_DESC: (a, b) => desc(inInr(a), inInr(b)),
    WEIGHT_DESC: (a, b) => desc(inInr(a), inInr(b)),
    DAY_PNL_PCT_DESC: (a, b) => desc(a.dayChangePct, b.dayChangePct),
    PNL_PCT_DESC: (a, b) => desc(a.pnlPct, b.pnlPct),
    NAME_ASC: () => 0,
  };
  return [...holdings].sort((a, b) => cmp[sort](a, b) || byName(a, b));
}

/**
 * Derives stock cards from BUY transactions (LLD §2.3). Transaction-level filters (platform,
 * market, exchange) apply **before** aggregation, so a card reflects only matching buys;
 * holding-level filters (sector, labels) apply after. Missing prices yield `null`s, never zeros.
 */
export function aggregateHoldings(
  txs: readonly BuyTransaction[],
  ctx: PricingContext,
  filters: PortfolioFilters,
): StockHolding[] {
  const platforms = new Set(filters.platforms.map(normalisePlatform));
  const groups = new Map<InstrumentKey, BuyTransaction[]>();
  for (const tx of txs) {
    if (!matchesTransactionFilters(tx, filters, platforms)) continue;
    const key = toInstrumentKey(tx.exchange, tx.symbol);
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }
  const holdings = [...groups.entries()]
    .map(([key, list]) => buildHolding(key, list, ctx))
    .filter((h) => matchesHoldingFilters(h, filters));
  return sortHoldings(holdings, filters.sort, ctx.fx.usdInr);
}
