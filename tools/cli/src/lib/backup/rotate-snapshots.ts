import { getBackupRetention } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { exec } from '../docker/exec';
import {
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  isValidSnapshotId,
} from './constants';
import { listSnapshots } from './list-snapshots';

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

async function listManifestlessDirs(backupVolume: string): Promise<string[]> {
  const result = await exec('docker', [
    'run',
    '--rm',
    '-v',
    `${backupVolume}:/backup:ro`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    // One directory name per line; `true` keeps the exit code 0 when the
    // volume is empty (the glob then matches nothing).
    'for d in /backup/*/; do [ -f "${d}manifest.json" ] || basename "$d"; done; true',
  ]);
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
  backupVolume: string,
  id: string,
): Promise<boolean> {
  // Ids are validated by the selectors; re-check before interpolating into a
  // shell command anyway (defense in depth).
  if (!isValidSnapshotId(id)) return false;
  const result = await exec('docker', [
    'run',
    '--rm',
    '-v',
    `${backupVolume}:/backup`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    `rm -rf /backup/${id}`,
  ]);
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
}): Promise<void> {
  const { prefix } = options;
  const { keepCount, keepDays } = getBackupRetention();
  const backupVolume = `${prefix}${BACKUP_VOLUME}`;

  const snapshots = await listSnapshots(prefix);
  const expired = selectSnapshotsToDelete(
    snapshots,
    keepCount,
    keepDays,
    new Date(),
  );
  const deleted: string[] = [];
  for (const id of expired) {
    if (await removeSnapshotDir(backupVolume, id)) deleted.push(id);
  }
  if (deleted.length > 0) {
    logger.info(
      `Rotated out ${deleted.length} snapshot(s) past retention (keep last ${keepCount} or ${keepDays} days): ${deleted.join(', ')}`,
    );
  }

  const torn = selectTornSnapshotDirs(
    await listManifestlessDirs(backupVolume),
    snapshots.map((snapshot) => snapshot.id),
  );
  const removedTorn: string[] = [];
  for (const id of torn) {
    if (await removeSnapshotDir(backupVolume, id)) removedTorn.push(id);
  }
  if (removedTorn.length > 0) {
    logger.info(
      `Removed ${removedTorn.length} incomplete snapshot(s) left by interrupted runs: ${removedTorn.join(', ')}`,
    );
  }
}
