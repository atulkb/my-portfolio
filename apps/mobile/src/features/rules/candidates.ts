import {
  buildRuleContext,
  computeIndicators,
  EXCHANGE_META,
  parseInstrumentKey,
  toInstrumentKey,
  type InstrumentKey,
  type MacroSnapshot,
  type RuleCandidate,
  type StockHolding,
  type WatchlistItem,
} from '@portfolio/core';

import { resolveSector, type SectorSources } from '@/features/analysis/sector';
import type { AnalysisEntry } from '@/stores/analysisStore';
import type { MarketState } from '@/stores/marketStore';

const NO_MACRO: MacroSnapshot = { indiaVix: null, vix: null, nifty: null, sp500: null };
/** Indicators of an unpriced instrument: every value `null`, so rules report insufficient data. */
const NO_INDICATORS = computeIndicators([]);

/** Everything needed to build rule contexts (LLD §2.8 `buildRuleContext`). */
export type CandidateSources = {
  readonly holdings: readonly StockHolding[];
  /** Items of every list (HLD D28: watchlist rules apply to all lists). */
  readonly watchItems: readonly WatchlistItem[];
  readonly analysis: ReadonlyMap<InstrumentKey, AnalysisEntry>;
  readonly market: Pick<MarketState, 'fundamentals' | 'macro'>;
  readonly sector: SectorSources;
};

/**
 * Rule candidates: one per holding (PORTFOLIO) and one per watched instrument (WATCHLIST). A stock
 * on several lists is evaluated once, with the first targets set on any list.
 */
export function buildRuleCandidates(src: CandidateSources, only?: InstrumentKey): RuleCandidate[] {
  const macro = src.market.macro ?? NO_MACRO;
  const base = (key: InstrumentKey) => {
    const parsed = parseInstrumentKey(key);
    if (!parsed) return null;
    const entry = src.analysis.get(key);
    return {
      indicators: entry?.indicators ?? NO_INDICATORS,
      fundamentals: src.market.fundamentals.get(key) ?? null,
      analysis: entry?.analysis ?? null,
      macro,
      sector: resolveSector(key, src.sector),
      market: EXCHANGE_META[parsed.exchange].market,
      exchange: parsed.exchange,
    };
  };

  const out: RuleCandidate[] = [];
  for (const h of src.holdings) {
    if (only && h.key !== only) continue;
    const b = base(h.key);
    if (b)
      out.push({
        key: h.key,
        scope: 'PORTFOLIO',
        ctx: buildRuleContext({ ...b, holding: { pnlPct: h.pnlPct, performance: h.performance } }),
      });
  }

  const targets = new Map<InstrumentKey, { entry: number | null; exit: number | null }>();
  for (const i of src.watchItems) {
    const key = toInstrumentKey(i.exchange, i.symbol);
    if (only && key !== only) continue;
    const prev = targets.get(key);
    targets.set(key, {
      entry: prev?.entry ?? i.targetEntryPrice,
      exit: prev?.exit ?? i.targetExitPrice,
    });
  }
  for (const [key, t] of targets) {
    const b = base(key);
    if (b)
      out.push({
        key,
        scope: 'WATCHLIST',
        ctx: buildRuleContext({ ...b, watchItem: { targetEntryPrice: t.entry, targetExitPrice: t.exit } }),
      });
  }
  return out;
}
