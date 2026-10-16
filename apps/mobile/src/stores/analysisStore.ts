import {
  analyseInstrument,
  computeIndicators,
  type AnalysisResult,
  type DailyBar,
  type Fundamentals,
  type IndicatorSet,
  type InstrumentKey,
  type MacroSnapshot,
  type Market,
  type SectorCategory,
} from '@portfolio/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** Indicators + deterministic analysis of one instrument (LLD §4.3). */
export type AnalysisEntry = {
  readonly indicators: IndicatorSet;
  readonly analysis: AnalysisResult;
  readonly sectorCategory: SectorCategory;
};

/** Inputs for one instrument; object identity of `bars`/`fundamentals` drives memoisation. */
export type AnalysisRow = {
  readonly key: InstrumentKey;
  readonly bars: readonly DailyBar[];
  /** `undefined` = not fetched yet; `null` = no data. Both score as missing (⚪). */
  readonly fundamentals: Fundamentals | null | undefined;
  readonly sectorCategory: SectorCategory;
  readonly market: Market;
};

/** Analysis store state (derived from market data, never persisted). */
export type AnalysisState = {
  readonly byKey: ReadonlyMap<InstrumentKey, AnalysisEntry>;
  /** Recomputes changed rows only; keys absent from `rows` are kept. */
  recompute(rows: readonly AnalysisRow[], macro: MacroSnapshot | null): void;
  reset(): void;
};

const NO_MACRO: MacroSnapshot = { indiaVix: null, vix: null, nifty: null, sp500: null };

/** Creates the analysis store: pure `core` calls, memoised on input identity. */
export function createAnalysisStore(): StoreApi<AnalysisState> {
  type Memo = { row: AnalysisRow; macro: MacroSnapshot | null; indicators: IndicatorSet };
  const memo = new Map<InstrumentKey, Memo>();

  return createStore<AnalysisState>()((set, get) => ({
    byKey: new Map(),

    recompute: (rows, macro) => {
      let next: Map<InstrumentKey, AnalysisEntry> | null = null;
      for (const row of rows) {
        const m = memo.get(row.key);
        const same =
          m &&
          m.row.bars === row.bars &&
          m.row.fundamentals === row.fundamentals &&
          m.row.sectorCategory === row.sectorCategory &&
          m.row.market === row.market &&
          m.macro === macro;
        if (same) continue;
        const indicators = m && m.row.bars === row.bars ? m.indicators : computeIndicators(row.bars);
        const analysis = analyseInstrument({
          indicators,
          fundamentals: row.fundamentals ?? null,
          sectorCategory: row.sectorCategory,
          market: row.market,
          macro: macro ?? NO_MACRO,
        });
        memo.set(row.key, { row, macro, indicators });
        next ??= new Map(get().byKey);
        next.set(row.key, { indicators, analysis, sectorCategory: row.sectorCategory });
      }
      if (next) set({ byKey: next });
    },

    reset: () => {
      memo.clear();
      set({ byKey: new Map() });
    },
  }));
}
