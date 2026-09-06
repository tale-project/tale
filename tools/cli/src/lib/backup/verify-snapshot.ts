import { exec } from '../docker/exec';
import {
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  SNAPSHOT_VOLUMES,
  isValidSnapshotId,
} from './constants';
import type { SnapshotManifest } from './create-snapshot';

/** Manifest hashes round-trip into a shell command: accept hex only. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Verify every volume archive the MANIFEST lists against the sha256 recorded
 * at snapshot time. The contract is the manifest, not the files that happen
 * to be present: an archive that went missing (an interrupted rotation, a
 * hand deletion) must fail here, because restore wipes the live volume
 * before it opens the archive. Throws on the first missing or mismatching
 * archive — restoring a torn or bit-rotted snapshot is worse than not
 * restoring at all.
 */
export async function verifySnapshot(
  prefix: string,
  manifest: Pick<SnapshotManifest, 'id' | 'volumes'>,
): Promise<void> {
  const { id } = manifest;
  if (!isValidSnapshotId(id)) {
    throw new Error(`Invalid snapshot id: ${id}`);
  }
  const checks: string[] = [];
  for (const [volume, info] of Object.entries(manifest.volumes)) {
    // Only the volumes the CLI itself snapshots, and only well-formed
    // hashes, reach the shell (a hand-edited manifest is untrusted input).
    if (!(SNAPSHOT_VOLUMES as readonly string[]).includes(volume)) continue;
    if (!SHA256_RE.test(info.sha256)) {
      throw new Error(
        `Snapshot ${id} failed integrity verification: ${volume}.tar.gz has a malformed sha256 in manifest.json`,
      );
    }
    checks.push(
      `test -f ${volume}.tar.gz || { echo "${volume}.tar.gz: MISSING" >&2; exit 1; }; ` +
        `echo "${info.sha256}  ${volume}.tar.gz" | sha256sum -c - || exit 1`,
    );
  }
  if (checks.length === 0) {
    throw new Error(`Snapshot ${id} lists no restorable volumes to verify`);
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
    `cd /backup/${id} && ${checks.join('; ')}`,
  ]);
  if (!result.success) {
    throw new Error(
      `Snapshot ${id} failed integrity verification: ${result.stderr || result.stdout}`,
    );
  }
}
