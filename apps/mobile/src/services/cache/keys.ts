/** MMKV keys (LLD §1.9). Keys under `device.` survive sign-out. */
export const KV_KEYS = {
  instrumentsMeta: 'instruments.meta',
  instrumentsTsv: 'instruments.tsv',
  instrumentsLastCheckAt: 'instruments.lastCheckAt',
  importLastBatch: 'import.lastBatch',
} as const;
