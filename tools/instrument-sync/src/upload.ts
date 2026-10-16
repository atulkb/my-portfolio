import {
  buildMasterUpload,
  checkBuildSanity,
  InstrumentMasterMetaSchema,
  nextMasterVersion,
  type InstrumentChunk,
  type InstrumentMasterMeta,
  type MasterUpload,
} from '@portfolio/core';

import { maxSourceDate } from './snapshot';

/** What `build` writes to out/build.json next to out/instruments.tsv. */
export type BuildOutput = {
  readonly tsv: string;
  readonly sourceDates: InstrumentMasterMeta['sourceDates'];
  readonly counts: InstrumentMasterMeta['counts'];
};

/** Firestore access used by the upload (Admin SDK in the CLI, a fake in tests). */
export interface MasterStore {
  /** Raw meta document data, or null when absent. */
  getMeta(): Promise<unknown>;
  listChunkIds(): Promise<string[]>;
  writeChunk(id: string, chunk: InstrumentChunk): Promise<void>;
  writeMeta(meta: InstrumentMasterMeta): Promise<void>;
  deleteChunks(ids: readonly string[]): Promise<void>;
}

/** Result of planning an upload against the live meta. */
export type UploadPlan =
  | { readonly kind: 'unchanged'; readonly live: InstrumentMasterMeta }
  | { readonly kind: 'rejected'; readonly problems: readonly string[] }
  | {
      readonly kind: 'upload';
      readonly upload: MasterUpload;
      readonly live: InstrumentMasterMeta | null;
    };

/**
 * Plans an upload: unchanged when the live hash already matches; rejected when the sanity check
 * against the live counts fails (HLD §15: ≥ 10,000 total, each market within ±20 %); otherwise
 * the next version's chunks and meta.
 */
export function planUpload(
  build: BuildOutput,
  liveRaw: unknown,
  opts: { readonly now: number; readonly sha256: (s: string) => string },
): UploadPlan {
  const parsed = liveRaw == null ? null : InstrumentMasterMetaSchema.safeParse(liveRaw);
  const live = parsed?.success ? parsed.data : null;
  const sha = opts.sha256(build.tsv);
  if (live && live.sha256 === sha) return { kind: 'unchanged', live };
  const sanity = checkBuildSanity(build.counts, live?.counts ?? null);
  if (!sanity.ok) return { kind: 'rejected', problems: sanity.error };
  const upload = buildMasterUpload({
    tsv: build.tsv,
    version: nextMasterVersion(maxSourceDate(build.sourceDates), live?.version ?? null),
    generatedAt: opts.now,
    sourceDates: build.sourceDates,
    counts: build.counts,
    sha256: opts.sha256,
  });
  return { kind: 'upload', upload, live };
}

/**
 * Writes chunks first, then the meta (so a reader of the old meta still finds its chunks), then
 * deletes chunks of other versions. Returns the ids deleted.
 */
export async function executeUpload(store: MasterStore, upload: MasterUpload): Promise<string[]> {
  for (const { id, ...chunk } of upload.chunks) await store.writeChunk(id, chunk);
  await store.writeMeta(upload.meta);
  const keep = new Set(upload.meta.chunkIds);
  const stale = (await store.listChunkIds()).filter((id) => !keep.has(id));
  if (stale.length > 0) await store.deleteChunks(stale);
  return stale;
}
