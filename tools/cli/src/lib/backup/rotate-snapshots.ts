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

/**
 * Delete snapshots past retention (see selectSnapshotsToDelete). Deletion
 * failures are warnings, not errors — rotation is housekeeping and must
 * never fail the deploy that triggered it.
 */
export async function rotateSnapshots(options: {
  prefix: string;
}): Promise<void> {
  const { prefix } = options;
  const { keepCount, keepDays } = getBackupRetention();

  const snapshots = await listSnapshots(prefix);
  const expired = selectSnapshotsToDelete(
    snapshots,
    keepCount,
    keepDays,
    new Date(),
  );
  if (expired.length === 0) return;

  const backupVolume = `${prefix}${BACKUP_VOLUME}`;
  const deleted: string[] = [];
  for (const id of expired) {
    // listSnapshots already validates ids; re-check before interpolating
    // into a shell command anyway (defense in depth).
    if (!isValidSnapshotId(id)) continue;
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
    if (result.success) {
      deleted.push(id);
    } else {
      logger.warn(`Failed to rotate out snapshot ${id}: ${result.stderr}`);
    }
  }
  if (deleted.length > 0) {
    logger.info(
      `Rotated out ${deleted.length} snapshot(s) past retention (keep last ${keepCount} or ${keepDays} days): ${deleted.join(', ')}`,
    );
  }
}
