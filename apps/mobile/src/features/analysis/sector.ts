import {
  sectorCategory,
  type InstrumentIndex,
  type InstrumentKey,
  type InstrumentProfile,
  type SectorCategory,
} from '@portfolio/core';

/** Sources for sector resolution (LLD §2.2 `sectorOf`). */
export type SectorSources = {
  readonly overrides: Readonly<Record<string, string>> | undefined;
  readonly profiles: ReadonlyMap<InstrumentKey, InstrumentProfile>;
  readonly index: InstrumentIndex | null;
};

/** Display sector: user override → provider profile → master-list industry (BSE) → `null`. */
export function resolveSector(key: InstrumentKey, src: SectorSources): string | null {
  return (
    src.overrides?.[key] ??
    src.profiles.get(key)?.sector ??
    src.index?.byKey.get(key)?.instrument.industry ??
    null
  );
}

/** Scoring bucket (ANALYSIS_FRAMEWORK §5) from the same sources, using the industry too. */
export function resolveSectorCategory(key: InstrumentKey, src: SectorSources): SectorCategory {
  const override = src.overrides?.[key];
  if (override) return sectorCategory(override);
  const profile = src.profiles.get(key);
  if (profile && (profile.sector || profile.industry))
    return sectorCategory(profile.sector, profile.industry);
  return sectorCategory(src.index?.byKey.get(key)?.instrument.industry ?? null);
}
