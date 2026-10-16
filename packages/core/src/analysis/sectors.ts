/** Sector buckets that change scoring (ANALYSIS_FRAMEWORK §5). */
export type SectorCategory = 'FINANCIALS' | 'UTILITIES_REAL_ESTATE' | 'TECH' | 'FMCG' | 'OTHER';

const RULES: readonly (readonly [SectorCategory, readonly string[]])[] = [
  [
    'FINANCIALS',
    ['financial', 'bank', 'insurance', 'nbfc', 'finance', 'capital market', 'asset management', 'credit'],
  ],
  ['UTILITIES_REAL_ESTATE', ['utilit', 'real estate', 'realty', 'reit', 'power generation']],
  ['TECH', ['technology', 'software', 'it services', 'information technology', 'semiconductor', 'internet']],
  [
    'FMCG',
    [
      'consumer defensive',
      'consumer staples',
      'fmcg',
      'food',
      'beverage',
      'household',
      'personal product',
      'tobacco',
    ],
  ],
];

/**
 * Maps a provider sector/industry string to a {@link SectorCategory} by keyword
 * (e.g. "Financial Services", "Banks—Regional" → FINANCIALS). Unknown → OTHER.
 */
export function sectorCategory(sector: string | null, industry: string | null = null): SectorCategory {
  const text = `${sector ?? ''} ${industry ?? ''}`.toLowerCase();
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => text.includes(k))) return category;
  }
  return 'OTHER';
}
