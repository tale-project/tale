/**
 * In-memory representation of a skill directory tree, plus the pure diff used to
 * detect sync drift between a `skills/<name>/` source and its committed copies.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isShipExcluded, SKIP_DIRS } from './exclude';

/**
 * A skill tree: POSIX skill-relative path -> raw file bytes. Bytes (not strings)
 * keep the diff binary-safe and exact — a skill may ship an image or a CRLF file
 * and the synced copy must be byte-identical.
 */
export type FileTree = Map<string, Uint8Array>;

/**
 * Read every regular file under `root` into a {@link FileTree}, keyed by POSIX
 * path relative to `root`. Returns an empty map if `root` does not exist (so a
 * not-yet-synced target diffs cleanly as "everything missing").
 *
 * - **Rejects symlinks** anywhere in the tree: a symlinked file/dir in a shipped
 *   skill is a path-traversal / supply-chain footgun (it could point outside the
 *   repo and be copied verbatim into `builtin-configs/`).
 * - Skips {@link SKIP_DIRS} (`node_modules`, `_generated`, `.history`).
 * - Throws on case-insensitive duplicate paths (would phantom-drift between a
 *   case-insensitive dev filesystem and case-sensitive CI).
 * - Does NOT apply the ship-exclusion suffixes — this is the literal on-disk
 *   tree. Ship-exclusion is applied by {@link expectedTargetTree} on the source
 *   side, which keeps a stale `*.test.ts` left in a target detectable as `extra`.
 */
export function readTree(root: string): FileTree {
  const tree: FileTree = new Map();
  const lowerToReal = new Map<string, string>();

  function walk(absDir: string, relDir: string): void {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return;
      throw err;
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) {
        throw new Error(`symlink not allowed in skill tree: ${rel}`);
      }
      if (stat.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!stat.isFile()) continue; // sockets / fifos / devices — ignore
      const lower = rel.toLowerCase();
      const clash = lowerToReal.get(lower);
      if (clash !== undefined) {
        throw new Error(
          `case-insensitive duplicate path in skill tree: "${rel}" vs "${clash}"`,
        );
      }
      lowerToReal.set(lower, rel);
      tree.set(rel, readFileSync(abs));
    }
  }

  walk(root, '');
  return tree;
}

/**
 * The canonical expected target tree: the source tree minus ship-excluded files.
 * Pure — feed it a hand-built map in tests.
 */
export function expectedTargetTree(source: FileTree): FileTree {
  const out: FileTree = new Map();
  for (const [rel, bytes] of source) {
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (isShipExcluded(base)) continue;
    out.set(rel, bytes);
  }
  return out;
}

/** Result of comparing an expected tree against an on-disk tree. */
export interface TreeDiff {
  /** Present in both, bytes differ. */
  readonly changed: readonly string[];
  /** In `expected`, absent on disk (target stale or never synced). */
  readonly missing: readonly string[];
  /** On disk, not in `expected` (stale leftover to delete). */
  readonly extra: readonly string[];
}

/** True iff a diff reports no drift. */
export function isClean(diff: TreeDiff): boolean {
  return (
    diff.changed.length === 0 &&
    diff.missing.length === 0 &&
    diff.extra.length === 0
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Compare an expected tree against an actual on-disk tree. Covers all four drift
 * classes: a changed file (`changed`), a file the target is missing (`missing`),
 * a stale leftover the target shouldn't have (`extra`), and — since a missing
 * directory reads as an empty tree — a wholly-absent target (every expected path
 * lands in `missing`). Results are sorted for stable output.
 */
export function diffTrees(expected: FileTree, actual: FileTree): TreeDiff {
  const changed: string[] = [];
  const missing: string[] = [];
  const extra: string[] = [];

  for (const [rel, want] of expected) {
    const got = actual.get(rel);
    if (got === undefined) missing.push(rel);
    else if (!bytesEqual(want, got)) changed.push(rel);
  }
  for (const rel of actual.keys()) {
    if (!expected.has(rel)) extra.push(rel);
  }

  return {
    changed: changed.sort(),
    missing: missing.sort(),
    extra: extra.sort(),
  };
}
