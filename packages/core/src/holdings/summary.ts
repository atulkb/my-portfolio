import { MARKETS, type Currency, type IsoDate, type Market } from '../models/primitives';
import { maxDate } from '../util/dates';
import { convert, rateOn } from './fx';
import type { FxContext, MarketSummary, PortfolioSummary, SectorGroup, StockHolding } from './types';
import { UNCLASSIFIED_SECTOR } from './types';
import { xirr, type Cashflow } from './xirr';

type Priced = StockHolding & { readonly value: number; readonly pnl: number; readonly priceDate: IsoDate };

const isPriced = (h: StockHolding): h is Priced => h.value !== null && h.pnl !== null && h.priceDate !== null;

/**
 * Groups holdings by sector (LLD §2.3), sectors ordered by value. Sector amounts and weights are
 * in `currency` (converted at the current rate); each holding keeps its native currency.
 * Holdings keep the order they arrive in (already sorted by the active sort).
 */
export function groupBySector(
  holdings: readonly StockHolding[],
  fx: FxContext,
  currency: Currency,
): SectorGroup[] {
  const conv = (amount: number, from: Currency): number => convert(amount, from, currency, fx.usdInr);
  const total = holdings.filter(isPriced).reduce((s, h) => s + conv(h.value, h.currency), 0);
  const groups = new Map<string, StockHolding[]>();
  for (const h of holdings) {
    const sector = h.sector ?? UNCLASSIFIED_SECTOR;
    const list = groups.get(sector);
    if (list) list.push(h);
    else groups.set(sector, [h]);
  }
  return [...groups.entries()]
    .map(([sector, list]) => {
      const priced = list.filter(isPriced);
      const value = priced.reduce((s, h) => s + conv(h.value, h.currency), 0);
      const invested = priced.reduce((s, h) => s + conv(h.invested, h.currency), 0);
      const pnl = value - invested;
      return {
        sector,
        holdings: list,
        value,
        invested,
        pnl,
        pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
        weightPct: total > 0 ? (value / total) * 100 : null,
      };
    })
    .sort((a, b) => b.value - a.value || a.sector.localeCompare(b.sector));
}

function xirrPctOf(flows: Cashflow[]): number | null {
  const r = xirr(flows);
  return r === null ? null : r * 100;
}

/**
 * Portfolio header (LLD §2.3) in the summary currency. Holdings without a price are excluded
 * and counted in `unpricedCount`. Portfolio XIRR converts each buy at the **historical** USD/INR
 * rate on its trade date and the terminal value at the current rate; per-market XIRR uses
 * native currency (no FX).
 */
export function summarisePortfolio(
  holdings: readonly StockHolding[],
  fx: FxContext,
  currency: Currency,
): PortfolioSummary {
  const priced = holdings.filter(isPriced);
  const conv = (amount: number, from: Currency): number => convert(amount, from, currency, fx.usdInr);

  const totalValue = priced.reduce((s, h) => s + conv(h.value, h.currency), 0);
  const invested = priced.reduce((s, h) => s + conv(h.invested, h.currency), 0);
  const dayChange = priced.reduce(
    (s, h) => s + (h.dayChange === null ? 0 : conv(h.dayChange, h.currency)),
    0,
  );
  const unrealisedPnl = totalValue - invested;
  const terminalDate = maxDate(priced.map((h) => h.priceDate));

  let portfolioXirr: number | null = null;
  if (terminalDate !== null) {
    const flows: Cashflow[] = [];
    let complete = true;
    for (const h of priced) {
      for (const broker of h.brokers) {
        for (const b of broker.buys) {
          const amount = b.quantity * b.price;
          if (h.currency === currency) flows.push({ date: b.tradeDate, amount: -amount });
          else {
            const rate = rateOn(fx, b.tradeDate);
            if (rate === null) complete = false;
            else flows.push({ date: b.tradeDate, amount: -convert(amount, h.currency, currency, rate) });
          }
        }
      }
    }
    flows.push({ date: terminalDate, amount: totalValue });
    portfolioXirr = complete ? xirrPctOf(flows) : null;
  }

  const markets: MarketSummary[] = [];
  for (const market of MARKETS) {
    const inMarket = priced.filter((h) => h.market === market);
    if (inMarket.length === 0) continue;
    markets.push(marketSummary(market, inMarket, totalValue, conv));
  }

  return {
    currency,
    totalValue,
    invested,
    unrealisedPnl,
    unrealisedPnlPct: invested > 0 ? (unrealisedPnl / invested) * 100 : null,
    dayChange,
    dayChangePct: totalValue - dayChange > 0 ? (dayChange / (totalValue - dayChange)) * 100 : null,
    xirrPct: portfolioXirr,
    markets,
    unpricedCount: holdings.length - priced.length,
    fx: { usdInr: fx.usdInr, asOf: fx.asOf },
  };
}

function marketSummary(
  market: Market,
  holdings: readonly Priced[],
  totalValue: number,
  conv: (amount: number, from: Currency) => number,
): MarketSummary {
  const nativeCurrency = holdings[0]?.currency ?? (market === 'IN' ? 'INR' : 'USD');
  const value = holdings.reduce((s, h) => s + h.value, 0);
  const terminal = maxDate(holdings.map((h) => h.priceDate));
  const flows: Cashflow[] = holdings.flatMap((h) =>
    h.brokers.flatMap((br) => br.buys.map((b) => ({ date: b.tradeDate, amount: -b.quantity * b.price }))),
  );
  if (terminal !== null) flows.push({ date: terminal, amount: value });
  return {
    market,
    value,
    currency: nativeCurrency,
    weightPct: totalValue > 0 ? (conv(value, nativeCurrency) / totalValue) * 100 : null,
    xirrPct: terminal === null ? null : xirrPctOf(flows),
  };
}
