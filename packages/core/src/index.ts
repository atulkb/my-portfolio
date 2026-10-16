/**
 * Public API of `@portfolio/core`.
 *
 * Pure TypeScript: no React Native, Firebase, network or clock access, so everything here is
 * unit-testable and reusable by future Cloud Functions. Modules are added per the approved LLD.
 */
export const CORE_VERSION = '0.1.0';

export * from './models/primitives';
export * from './models/user';
export * from './models/transaction';
export * from './models/watchlist';
export * from './models/rule';
export * from './models/instrument';
export * from './rules/variables';
export * from './market/types';
export * from './errors';
export type * from './ports';
