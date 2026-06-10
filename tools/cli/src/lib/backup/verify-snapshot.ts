import { exec } from '../docker/exec';
import {
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  isValidSnapshotId,
} from './constants';

/**
 * Verify every volume archive in a snapshot against the sha256 sidecars
 * written at snapshot time. Throws on the first mismatch — restoring a
 * torn or bit-rotted archive is worse than not restoring at all.
 */
export async function verifySnapshot(
  prefix: string,
  id: string,
): Promise<void> {
  if (!isValidSnapshotId(id)) {
    throw new Error(`Invalid snapshot id: ${id}`);
  }
  const backupVolume = `${prefix}${BACKUP_VOLUME}`;
  const result = await exec('docker', [
    'run',
    '--rm',
    '-v',
    `${backupVolume}:/backup:ro`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    `cd /backup/${id} && sha256sum -c *.tar.gz.sha256`,
  ]);
  if (!result.success) {
    throw new Error(
      `Snapshot ${id} failed integrity verification: ${result.stderr || result.stdout}`,
    );
  }
}
