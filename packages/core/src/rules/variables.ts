import { z } from 'zod';
import { EXCHANGES, MARKETS } from '../models/primitives';

/** Where a rule variable has a value. */
export type RuleScope = 'PORTFOLIO' | 'WATCHLIST';

const BOTH: readonly RuleScope[] = ['PORTFOLIO', 'WATCHLIST'];
const PORTFOLIO_ONLY: readonly RuleScope[] = ['PORTFOLIO'];
const WATCHLIST_ONLY: readonly RuleScope[] = ['WATCHLIST'];
const LABEL_VALUES = ['GOOD', 'AVERAGE', 'BAD'] as const;

/** Definition of one whitelisted rule variable. */
export type RuleVariableDef =
  | { readonly type: 'number'; readonly label: string; readonly scopes: readonly RuleScope[] }
  | { readonly type: 'string'; readonly label: string; readonly scopes: readonly RuleScope[] }
  | {
      readonly type: 'enum';
      readonly values: readonly string[];
      readonly label: string;
      readonly scopes: readonly RuleScope[];
    };

const num = (label: string, scopes: readonly RuleScope[] = BOTH): RuleVariableDef => ({
  type: 'number',
  label,
  scopes,
});

/**
 * The only source of the rule-variable whitelist (ANALYSIS_FRAMEWORK §8): used by the
 * validator, the stored-rule schema, the read-back renderer and the Gemini prompt.
 */
export const RULE_VARIABLES = {
  // Price & trend
  close: num('Close price'),
  closePrev: num('Previous close'),
  sma20: num('20-day moving average'),
  sma50: num('50-day moving average'),
  sma200: num('200-day moving average'),
  sma20Prev: num('Previous 20-day moving average'),
  sma50Prev: num('Previous 50-day moving average'),
  sma200Prev: num('Previous 200-day moving average'),
  high52w: num('52-week high'),
  low52w: num('52-week low'),
  drawdownPct: num('Drop from 52-week high %'),
  changePct: num('Change vs previous close %'),
  // Momentum & volume
  rsi14: num('RSI (14)'),
  macd: num('MACD'),
  macdSignal: num('MACD signal'),
  macdPrev: num('Previous MACD'),
  macdSignalPrev: num('Previous MACD signal'),
  volume: num('Volume'),
  avgVolume30: num('30-day average volume'),
  volatilityPct: num('Annualised volatility %'),
  // Fundamentals
  pe: num('P/E'),
  pb: num('P/B'),
  peg: num('PEG'),
  roe: num('ROE %'),
  de: num('Debt / Equity'),
  revenueGrowthPct: num('Revenue growth %'),
  epsGrowthPct: num('EPS growth %'),
  netMarginPct: num('Net margin %'),
  dividendYieldPct: num('Dividend yield %'),
  // Scores
  healthScore: num('Health score'),
  healthLabel: { type: 'enum', values: LABEL_VALUES, label: 'Health', scopes: BOTH },
  performanceLabel: { type: 'enum', values: LABEL_VALUES, label: 'Performance', scopes: PORTFOLIO_ONLY },
  // Position / watchlist
  pnlPct: num('Your P/L %', PORTFOLIO_ONLY),
  targetEntryPrice: num('Target entry price', WATCHLIST_ONLY),
  targetExitPrice: num('Target exit price', WATCHLIST_ONLY),
  // Classification
  sector: { type: 'string', label: 'Sector', scopes: BOTH },
  market: { type: 'enum', values: MARKETS, label: 'Market', scopes: BOTH },
  exchange: { type: 'enum', values: EXCHANGES, label: 'Exchange', scopes: BOTH },
  // Macro
  indiaVix: num('India VIX'),
  vix: num('CBOE VIX'),
} as const satisfies Record<string, RuleVariableDef>;

/** Name of a whitelisted rule variable. */
export type RuleVariable = keyof typeof RULE_VARIABLES;

/** All whitelisted variable names, in declaration order. */
export const RULE_VARIABLE_NAMES = Object.keys(RULE_VARIABLES) as [RuleVariable, ...RuleVariable[]];

/** zod enum over {@link RULE_VARIABLE_NAMES}. */
export const RuleVariableSchema = z.enum(RULE_VARIABLE_NAMES);
