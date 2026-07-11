/**
 * Content-addressed world digests for migration data-integrity comparisons.
 *
 * DB: per-table MULTISET of canonical row strings — `_id`/`_creationTime`
 * stripped (table-rows restores and inverse re-inserts mint fresh ones by
 * design), keys sorted, rows sorted — so storage order and identity churn
 * never produce false diffs while any CONTENT change does.
 *
 * FS: relative-path → sha256. JSON files hash their key-sorted parsed value
 * (atomic writers may reorder keys; key order is not part of the contract);
 * other files hash raw bytes; directories are not compared (empty dirs and
 * mkdir -p side effects are noise).
 *
 * Pure node module (crypto/fs) shared by the chain harness (vitest node env)
 * and the container e2e (bun script). Two-dot basename keeps it out of the
 * Convex bundle.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  EQUALITY_EXEMPTIONS,
  isFsPathExempt,
  isTableExempt,
} from './equality.testkit';

export interface WorldDigest {
  /** table → sorted canonical row strings (multiset). */
  readonly db: Readonly<Record<string, readonly string[]>>;
  /** config-relative posix path → content hash. */
  readonly fs: Readonly<Record<string, string>>;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function canonicalRow(
  doc: Record<string, unknown>,
  dropFields: readonly string[] = [],
): string {
  const drop = new Set(['_id', '_creationTime', ...dropFields]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!drop.has(key)) out[key] = value;
  }
  return stableStringify(out);
}

export interface DigestOptions {
  /** Per-spec drop fields applied ON TOP of the central equality policy. */
  readonly extraDropFields?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Digest the given tables through a row collector (`t.run` in convex-test,
 * `dumpTables` over the wire in the container e2e). Exempt tables are skipped
 * per the central policy.
 */
export async function digestDb(
  tables: readonly string[],
  collect: (table: string) => Promise<Array<Record<string, unknown>>>,
  opts: DigestOptions = {},
): Promise<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const table of [...tables].sort()) {
    if (isTableExempt(table)) continue;
    const rows = await collect(table);
    const dropFields = [
      ...(EQUALITY_EXEMPTIONS.dropFields[table] ?? []),
      ...(opts.extraDropFields?.[table] ?? []),
    ];
    out[table] = rows.map((row) => canonicalRow(row, dropFields)).sort();
  }
  return out;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

async function walkFiles(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // missing root = empty tree
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Digest a config root ($TALE_CONFIG_DIR). */
export async function digestFs(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of (await walkFiles(root, root)).sort()) {
    if (isFsPathExempt(rel)) continue;
    const raw = await readFile(path.join(root, ...rel.split('/')));
    if (rel.endsWith('.json')) {
      try {
        out[rel] = sha256(stableStringify(JSON.parse(raw.toString('utf-8'))));
        continue;
      } catch {
        // Unparseable JSON is compared byte-wise like any other file.
      }
    }
    out[rel] = sha256(raw);
  }
  return out;
}

export async function digestWorld(
  tables: readonly string[],
  collect: (table: string) => Promise<Array<Record<string, unknown>>>,
  configRoot: string,
  opts: DigestOptions = {},
): Promise<WorldDigest> {
  return {
    db: await digestDb(tables, collect, opts),
    fs: await digestFs(configRoot),
  };
}

const MAX_ROW_PREVIEW = 220;

function preview(row: string): string {
  return row.length > MAX_ROW_PREVIEW
    ? `${row.slice(0, MAX_ROW_PREVIEW)}…`
    : row;
}

function diffMultiset(
  table: string,
  before: readonly string[],
  after: readonly string[],
  out: string[],
): void {
  const counts = new Map<string, number>();
  for (const row of before) counts.set(row, (counts.get(row) ?? 0) + 1);
  for (const row of after) counts.set(row, (counts.get(row) ?? 0) - 1);
  for (const [row, n] of counts) {
    if (n > 0) out.push(`${table}: MISSING after (×${n}): ${preview(row)}`);
    if (n < 0) out.push(`${table}: EXTRA after (×${-n}): ${preview(row)}`);
  }
}

/**
 * Human-readable digest diff — empty array means equal. Failure output ends
 * with the active exemption list so a hidden exemption can never masquerade
 * as equality.
 */
export function diffWorldDigests(
  before: WorldDigest,
  after: WorldDigest,
): string[] {
  const out: string[] = [];

  const tables = new Set([...Object.keys(before.db), ...Object.keys(after.db)]);
  for (const table of [...tables].sort()) {
    const a = before.db[table];
    const b = after.db[table];
    if (a === undefined) {
      out.push(`table ${table}: absent before, ${b?.length ?? 0} row(s) after`);
    } else if (b === undefined) {
      out.push(`table ${table}: ${a.length} row(s) before, absent after`);
    } else if (a.join('\n') !== b.join('\n')) {
      diffMultiset(table, a, b, out);
    }
  }

  const paths = new Set([...Object.keys(before.fs), ...Object.keys(after.fs)]);
  for (const rel of [...paths].sort()) {
    const a = before.fs[rel];
    const b = after.fs[rel];
    if (a === undefined) out.push(`fs ${rel}: created (not in before)`);
    else if (b === undefined) out.push(`fs ${rel}: missing after`);
    else if (a !== b) out.push(`fs ${rel}: content differs`);
  }

  return out;
}
