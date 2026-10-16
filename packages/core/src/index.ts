/**
 * Public API of `@portfolio/core`.
 *
 * Pure TypeScript: no React Native, Firebase, network or clock access, so everything here is
 * unit-testable and reusable by future Cloud Functions. Modules are added per the approved LLD.
 */
export const CORE_VERSION = '0.1.0';

// Models & errors (LLD §1, §5)
export * from './models/primitives';
export * from './models/user';
export * from './models/transaction';
export * from './models/watchlist';
export * from './models/rule';
export * from './models/instrument';
export * from './errors';
export type * from './ports';

// Utilities
export * from './util/result';
export { round, roundOrNull, pctChange } from './util/numbers';
export { hashInput, canonicalJson } from './util/hash';
export { addDays, daysBetween } from './util/dates';

// Market data & sessions (LLD §2.2)
export * from './market/types';
export * from './market/session';

// Holdings, XIRR, benchmark (LLD §2.3–2.5)
export * from './holdings/types';
export * from './holdings/xirr';
export * from './holdings/benchmark';
export * from './holdings/fx';
export { aggregateHoldings, sortHoldings } from './holdings/aggregate';
export { groupBySector, summarisePortfolio } from './holdings/summary';

// Indicators & analysis (LLD §2.6–2.7)
export * from './indicators/compute';
export * from './analysis/types';
export * from './analysis/thresholds';
export * from './analysis/sectors';
export { analyseInstrument, assessMacro, healthLabelFor } from './analysis/analyse';

// Rules (LLD §2.8)
export * from './rules/variables';
export * from './rules/validate';
export * from './rules/evaluate';
export * from './rules/readback';
export * from './rules/context';

// CSV import (LLD §2.9)
export * from './csv/types';
export * from './csv/duplicates';
export { parseHoldingsCsv } from './csv/parse';

// Instrument master (LLD §2.10)
export * from './instruments/build';
export * from './instruments/tsv';
export * from './instruments/search';

// Prompts (LLD §3.5)
export type * from './prompts/types';
export * from './prompts/grounding';
export * from './prompts/performanceRating';
export * from './prompts/signals';
export * from './prompts/deepAnalysis';
export * from './prompts/ruleCompile';
export * from './prompts/marketSentiment';
