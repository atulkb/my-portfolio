/**
 * Instrument master sync (LLD §3.6). Run from the repo root:
 *   npm run sync -- build --snapshot data/instruments/snapshot-2026-10-15
 *   npm run sync -- upload --dry-run
 *   npm run sync -- upload
 *   npm run sync -- download --out data/instruments/snapshot-2026-10-20
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { buildInstrumentMaster, checkBuildSanity, type BuildCounts } from '@portfolio/core';

import { downloadSnapshot } from './download';
import { ADC_HELP, createAdminStore, isCredentialError } from './firestore';
import { readSnapshot } from './snapshot';
import { executeUpload, planUpload, type BuildOutput } from './upload';

const REPO_ROOT = resolve(__dirname, '../../..');
const OUT_DIR = join(__dirname, '..', 'out');
const TSV_FILE = join(OUT_DIR, 'instruments.tsv');
const BUILD_FILE = join(OUT_DIR, 'build.json');
const DATA_DIR = join(REPO_ROOT, 'data', 'instruments');

/** npm runs workspace scripts in the workspace folder; resolve user paths from where npm was invoked. */
const fromInvocation = (p: string): string => resolve(process.env.INIT_CWD ?? process.cwd(), p);

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function argValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function projectId(args: readonly string[]): string {
  const explicit = argValue(args, '--project');
  if (explicit) return explicit;
  const rc = JSON.parse(readFileSync(join(REPO_ROOT, '.firebaserc'), 'utf8')) as {
    projects?: { default?: string };
  };
  const id = rc.projects?.default;
  if (!id) throw new Error('No --project given and no default in .firebaserc.');
  return id;
}

function build(args: readonly string[]): void {
  const snapshotArg = argValue(args, '--snapshot');
  if (!snapshotArg) throw new Error('Usage: build --snapshot data/instruments/snapshot-YYYY-MM-DD');
  const folder = fromInvocation(snapshotArg);
  const { sources, sourceDates } = readSnapshot(folder);
  const { tsv, counts } = buildInstrumentMaster(sources);

  const previous = existsSync(BUILD_FILE)
    ? (JSON.parse(readFileSync(BUILD_FILE, 'utf8')) as { counts: BuildCounts }).counts
    : null;
  const sanity = checkBuildSanity(counts, previous);

  console.log(`Snapshot   ${relative(REPO_ROOT, folder)}`);
  console.log(`Sources    NSE ${sourceDates.nse} · BSE ${sourceDates.bse} · US ${sourceDates.us}`);
  console.log(
    `Counts     total ${counts.total} · NSE ${counts.nse} · BSE ${counts.bse} · US ${counts.us} · NSE+BSE ${counts.nseBseOverlap}`,
  );
  console.log(`Skipped    ${JSON.stringify(counts.skipped)}`);
  console.log(
    `TSV        ${(Buffer.byteLength(tsv, 'utf8') / 1024 / 1024).toFixed(2)} MB · sha256 ${sha256(tsv)}`,
  );
  if (!sanity.ok) {
    console.error(`Sanity check FAILED (vs previous local build):\n  ${sanity.error.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Sanity     OK${previous ? ' (vs previous local build)' : ''}`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(TSV_FILE, tsv);
  const out: Omit<BuildOutput, 'tsv'> & { counts: BuildCounts; snapshot: string } = {
    sourceDates,
    counts,
    snapshot: relative(REPO_ROOT, folder),
  };
  writeFileSync(BUILD_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote      ${relative(REPO_ROOT, TSV_FILE)}, ${relative(REPO_ROOT, BUILD_FILE)}`);
}

function readBuild(): BuildOutput {
  if (!existsSync(TSV_FILE) || !existsSync(BUILD_FILE))
    throw new Error('No build output — run `npm run sync -- build --snapshot …` first.');
  const meta = JSON.parse(readFileSync(BUILD_FILE, 'utf8')) as Omit<BuildOutput, 'tsv'> & {
    counts: BuildCounts;
  };
  const { total, nse, bse, us } = meta.counts;
  return {
    tsv: readFileSync(TSV_FILE, 'utf8'),
    sourceDates: meta.sourceDates,
    counts: { total, nse, bse, us },
  };
}

async function upload(args: readonly string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const project = projectId(args);
  const store = createAdminStore(project);
  const plan = planUpload(readBuild(), await store.getMeta(), { now: Date.now(), sha256 });

  console.log(`Project    ${project}${dryRun ? '  (dry run — nothing is written)' : ''}`);
  if (plan.kind === 'unchanged') {
    console.log(`Unchanged  live version ${plan.live.version} already has this exact list.`);
    return;
  }
  if (plan.kind === 'rejected') {
    console.error(`Sanity check FAILED (vs live):\n  ${plan.problems.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  const { meta, chunks } = plan.upload;
  const live = plan.live;
  console.log(
    `Live       ${live ? `${live.version} · total ${live.counts.total} (NSE ${live.counts.nse} · BSE ${live.counts.bse} · US ${live.counts.us})` : 'none'}`,
  );
  console.log(
    `New        ${meta.version} · total ${meta.counts.total} (NSE ${meta.counts.nse} · BSE ${meta.counts.bse} · US ${meta.counts.us})`,
  );
  for (const c of chunks)
    console.log(`  chunk    ${c.id} · ${(Buffer.byteLength(c.tsv, 'utf8') / 1024).toFixed(0)} KB`);
  console.log(`  meta     reference/instruments · sha256 ${meta.sha256}`);
  if (dryRun) {
    console.log(`Would write ${chunks.length + 1} documents, then delete chunks of older versions.`);
    return;
  }
  const deleted = await executeUpload(store, plan.upload);
  console.log(`Uploaded   ${chunks.length} chunks + meta; deleted ${deleted.length} old chunk(s).`);
}

async function download(args: readonly string[]): Promise<void> {
  const outArg = argValue(args, '--out');
  if (!outArg) throw new Error('Usage: download --out data/instruments/snapshot-YYYY-MM-DD');
  const out = fromInvocation(outArg);
  // Only ever write inside the repo's data/instruments folder.
  if (!out.startsWith(DATA_DIR + sep))
    throw new Error(`--out must be inside ${relative(REPO_ROOT, DATA_DIR)}`);
  const date = /snapshot-(\d{4}-\d{2}-\d{2})$/.exec(out)?.[1];
  if (!date) throw new Error('--out folder must be named snapshot-YYYY-MM-DD');
  await downloadSnapshot(out, date);
  console.log(
    `Downloaded into ${relative(REPO_ROOT, out)}. Next: npm run sync -- build --snapshot ${relative(REPO_ROOT, out)}`,
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build') build(args);
  else if (command === 'upload') await upload(args);
  else if (command === 'download') await download(args);
  else {
    console.error('Commands: build --snapshot <folder> | upload [--dry-run] | download --out <folder>');
    process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error(isCredentialError(e) ? ADC_HELP : e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
