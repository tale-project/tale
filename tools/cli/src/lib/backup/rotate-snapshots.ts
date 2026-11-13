import { getBackupRetention } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { dockerRuntime } from '../runtime/docker/docker-runtime';
import {
  snapshotStoreOf,
  type IncusSnapshotStore,
} from '../runtime/incus/verbs/snapshots';
import type { StackRuntime } from '../runtime/types';
import {
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  isValidSnapshotId,
} from './constants';
import { listSnapshots } from './list-snapshots';
import { nativeSource, type SnapshotManifest } from './manifest';

interface RotationCandidate {
  id: string;
  createdAt: string;
}

/**
 * Retention policy: keep the newest `keepCount` snapshots AND everything
 * newer than `keepDays` days — whichever is more generous. A snapshot is
 * deleted only when it is both beyond the count window and past the age
 * window, so a quiet instance keeps its last snapshots indefinitely.
 */
export function selectSnapshotsToDelete(
  candidates: RotationCandidate[],
  keepCount: number,
  keepDays: number,
  now: Date,
): string[] {
  const newestFirst = [...candidates].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return newestFirst
    .filter(
      (snapshot, index) =>
        index >= keepCount && new Date(snapshot.createdAt).getTime() < cutoff,
    )
    .map((snapshot) => snapshot.id);
}

/** The `<YYYYMMDD>-<HHMMSS>` part of a snapshot id — what orders them. */
function snapshotTimestamp(id: string): string {
  return id.slice(0, 15);
}

/**
 * Torn snapshots: a directory on the backups volume WITHOUT a manifest.json.
 * The manifest is written last, so a tar that failed, timed out or was
 * interrupted leaves its partial archives (as large as the blob store) under
 * an id nothing lists or restores. Any such directory older than the newest
 * complete snapshot is garbage — the run that owned it is over (snapshots
 * run under the deploy lock, so no other run can still be writing it). With
 * no complete snapshot at all nothing is removed: the only candidate could
 * be the run in progress.
 */
export function selectTornSnapshotDirs(
  manifestlessDirs: string[],
  completeIds: string[],
): string[] {
  const newest = completeIds
    .filter(isValidSnapshotId)
    .map(snapshotTimestamp)
    .sort()
    .at(-1);
  if (!newest) return [];
  return manifestlessDirs.filter(
    (id) => isValidSnapshotId(id) && snapshotTimestamp(id) < newest,
  );
}

async function listManifestlessDirs(
  runtime: StackRuntime,
  backupVolume: string,
): Promise<string[]> {
  const result = await runtime.oneShot({
    image: BACKUP_HELPER_IMAGE,
    mounts: [{ volume: backupVolume, target: '/backup', readOnly: true }],
    argv: [
      'sh',
      '-c',
      // One directory name per line; `true` keeps the exit code 0 when the
      // volume is empty (the glob then matches nothing).
      'for d in /backup/*/; do [ -f "${d}manifest.json" ] || basename "$d"; done; true',
    ],
  });
  if (!result.success) {
    logger.warn(
      `Could not scan ${backupVolume} for torn snapshots: ${result.stderr}`,
    );
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function removeSnapshotDir(
  runtime: StackRuntime,
  backupVolume: string,
  id: string,
): Promise<boolean> {
  // Ids are validated by the selectors; re-check before interpolating into a
  // shell command anyway (defense in depth).
  if (!isValidSnapshotId(id)) return false;
  const result = await runtime.oneShot({
    image: BACKUP_HELPER_IMAGE,
    mounts: [{ volume: backupVolume, target: '/backup' }],
    argv: ['sh', '-c', `rm -rf /backup/${id}`],
  });
  if (!result.success) {
    logger.warn(`Failed to rotate out snapshot ${id}: ${result.stderr}`);
  }
  return result.success;
}

/**
 * Delete snapshots past retention (see selectSnapshotsToDelete) and torn
 * snapshot directories (see selectTornSnapshotDirs). Deletion failures are
 * warnings, not errors — rotation is housekeeping and must never fail the
 * deploy that triggered it.
 */
export async function rotateSnapshots(options: {
  prefix: string;
  /** The runtime the command selected; Docker when not given. */
  runtime?: StackRuntime;
}): Promise<void> {
  const { prefix } = options;
  const runtime = options.runtime ?? dockerRuntime;
  const { keepCount, keepDays } = getBackupRetention();
  const store = snapshotStoreOf(runtime);
  if (store !== null) {
    await rotateNativeSnapshots(store, keepCount, keepDays);
    return;
  }
  const backupVolume = `${prefix}${BACKUP_VOLUME}`;

  const snapshots = await listSnapshots(prefix, runtime);
  const expired = selectSnapshotsToDelete(
    snapshots,
    keepCount,
    keepDays,
    new Date(),
  );
  const deleted: string[] = [];
  for (const id of expired) {
    if (await removeSnapshotDir(runtime, backupVolume, id)) deleted.push(id);
  }
  if (deleted.length > 0) {
    logger.info(
      `Rotated out ${deleted.length} snapshot(s) past retention (keep last ${keepCount} or ${keepDays} days): ${deleted.join(', ')}`,
    );
  }

  const torn = selectTornSnapshotDirs(
    await listManifestlessDirs(runtime, backupVolume),
    snapshots.map((snapshot) => snapshot.id),
  );
  const removedTorn: string[] = [];
  for (const id of torn) {
    if (await removeSnapshotDir(runtime, backupVolume, id))
      removedTorn.push(id);
  }
  if (removedTorn.length > 0) {
    logger.info(
      `Removed ${removedTorn.length} incomplete snapshot(s) left by interrupted runs: ${removedTorn.join(', ')}`,
    );
  }
}

/** Delete one snapshot of a native set: its native snapshots wherever they
 * live now, then its directory (manifests and archives). */
async function removeNativeSnapshot(
  store: IncusSnapshotStore,
  manifest: SnapshotManifest,
): Promise<boolean> {
  try {
    for (const [volume, info] of Object.entries(manifest.volumes)) {
      const source = nativeSource(volume, info);
      if (source !== null)
        await store.deleteNativeSnapshot(source.volume, source.snapshot);
    }
    await store.deleteSnapshotDirectory(manifest.id);
    return true;
  } catch (error) {
    logger.warn(
      `Failed to rotate out snapshot ${manifest.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Incus: the same retention over native sets. An expired set's native
 * snapshots and archives go; a torn directory older than the newest set
 * goes; and a restore's holder goes once no kept manifest names a snapshot
 * on it (design D-29, R-06), never before. Failures are warnings.
 */
async function rotateNativeSnapshots(
  store: IncusSnapshotStore,
  keepCount: number,
  keepDays: number,
): Promise<void> {
  const snapshots = await store.listManifests();
  const expired = new Set(
    selectSnapshotsToDelete(snapshots, keepCount, keepDays, new Date()),
  );
  const deleted: string[] = [];
  for (const manifest of snapshots)
    if (
      expired.has(manifest.id) &&
      (await removeNativeSnapshot(store, manifest))
    )
      deleted.push(manifest.id);
  if (deleted.length > 0)
    logger.info(
      `Rotated out ${deleted.length} snapshot(s) past retention (keep last ${keepCount} or ${keepDays} days): ${deleted.join(', ')}`,
    );

  const torn = selectTornSnapshotDirs(
    await store.manifestlessDirectories(),
    snapshots.map((snapshot) => snapshot.id),
  );
  const removedTorn: string[] = [];
  for (const id of torn) {
    try {
      await store.deleteSnapshotDirectory(id);
      removedTorn.push(id);
    } catch (error) {
      logger.warn(
        `Failed to remove the incomplete snapshot ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (removedTorn.length > 0)
    logger.info(
      `Removed ${removedTorn.length} incomplete snapshot(s) left by interrupted runs: ${removedTorn.join(', ')}`,
    );

  try {
    const kept = snapshots.filter((manifest) => !deleted.includes(manifest.id));
    const newest = kept[0]?.createdAt;
    if (newest !== undefined) {
      const orphans = await store.deleteOrphanSnapshots(kept, newest);
      if (orphans.length > 0)
        logger.info(
          `Deleted ${orphans.length} native snapshot(s) of sets interrupted before their manifest: ${orphans.join(', ')}`,
        );
    }
    const holders = await store.deleteUnreferencedHolders(kept);
    if (holders.length > 0)
      logger.info(
        `Deleted ${holders.length} restore holder(s) no kept snapshot names any more: ${holders.join(', ')}`,
      );
  } catch (error) {
    logger.warn(
      `Could not clean up restore holders: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
