'use node';

/**
 * Filesystem snapshot sidecar for `fs-tree` migrations. Before a node migration
 * overwrites an org's on-disk config subtree, it copies the subtree here so the
 * migration's `down` can restore it byte-for-byte.
 *
 * Snapshots live OUTSIDE the org tree, under a dotted sidecar root so the
 * config readers (which enumerate org dirs) never pick them up:
 *   $TALE_CONFIG_DIR/.migration-snapshots/<safeMigrationId>/<orgSlug>/
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { getConfigRoot, validateOrgSlug } from '../../lib/file_io';

const SIDECAR_DIR = '.migration-snapshots';

/** Migration ids contain `/` and `.`; flatten to a single safe path segment. */
function safeMigrationSegment(migrationId: string): string {
  const seg = migrationId.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (seg.length === 0) throw new Error(`Unusable migrationId: ${migrationId}`);
  return seg;
}

function snapshotDir(migrationId: string, orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot('migration-snapshots'),
    SIDECAR_DIR,
    safeMigrationSegment(migrationId),
    orgSlug,
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively copy `dir` into the migration's per-org sidecar and return the
 * sidecar path (the snapshot ref). Idempotent: an existing snapshot is replaced
 * so a resumed run re-captures the current state. A missing source `dir` yields
 * an empty snapshot (the org simply had no files yet) — the ref still resolves.
 */
export async function snapshotFsTree(
  migrationId: string,
  orgSlug: string,
  dir: string,
): Promise<string> {
  const dest = snapshotDir(migrationId, orgSlug);
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  if (await exists(dir)) {
    await cp(dir, dest, { recursive: true });
  } else {
    await mkdir(dest, { recursive: true });
  }
  return dest;
}

/**
 * Restore a previously-captured snapshot back onto `dir`, replacing whatever is
 * there now. No-op-safe if the snapshot is missing (logs and leaves `dir`
 * untouched rather than wiping live data on a bad ref).
 */
export async function restoreFsTree(
  migrationId: string,
  orgSlug: string,
  dir: string,
): Promise<void> {
  const ref = snapshotDir(migrationId, orgSlug);
  if (!(await exists(ref))) {
    console.warn(
      `[snapshot_store] snapshot ref not found, skipping restore: ${ref}`,
    );
    return;
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.dirname(dir), { recursive: true });
  await cp(ref, dir, { recursive: true });
}
