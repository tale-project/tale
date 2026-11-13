import { dockerRuntime } from '../runtime/docker/docker-runtime';
import { snapshotStoreOf } from '../runtime/incus/verbs/snapshots';
import type { StackRuntime } from '../runtime/types';
import {
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  RESTORABLE_ARCHIVES,
  isValidSnapshotId,
} from './constants';
import type { SnapshotManifest } from './manifest';

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
 *
 * A volume a native snapshot holds (Incus, manifest v2) is checked against
 * Incus instead: the snapshot exists where the manifest says, was taken when
 * it says, and the set's snapshots all fall inside its freeze window. Its
 * archive, when it has one, is checked as above.
 */
export async function verifySnapshot(
  prefix: string,
  manifest: Pick<SnapshotManifest, 'id' | 'volumes'> &
    Partial<Pick<SnapshotManifest, 'freeze'>>,
  runtime: StackRuntime = dockerRuntime,
): Promise<void> {
  const { id } = manifest;
  if (!isValidSnapshotId(id)) {
    throw new Error(`Invalid snapshot id: ${id}`);
  }
  const store = snapshotStoreOf(runtime);
  const natives = Object.values(manifest.volumes).filter(
    (info) => info.native !== undefined,
  ).length;
  if (natives > 0) {
    if (store === null)
      throw new Error(
        `Snapshot ${id} holds native Incus snapshots, which this runtime cannot read.`,
      );
    const problems = await store.verifyNative({
      ...manifest,
      createdAt: '',
      cliVersion: '',
      platformVersion: null,
      trigger: 'manual',
    });
    if (problems.length > 0)
      throw new Error(
        `Snapshot ${id} failed integrity verification: ${problems.join('; ')}`,
      );
  }
  const checks: string[] = [];
  for (const [volume, info] of Object.entries(manifest.volumes)) {
    // Only archive names a restore would actually extract, and only
    // well-formed hashes, reach the shell (a hand-edited manifest is
    // untrusted input). The list is the RESTORE's, not the snapshot's: a
    // pre-rename snapshot's `convex-data.tar.gz` gets verified, because it
    // is about to be extracted into `config-data`.
    if (!(RESTORABLE_ARCHIVES as readonly string[]).includes(volume)) continue;
    if (info.sha256 === undefined && info.native !== undefined) continue;
    if (info.sha256 === undefined || !SHA256_RE.test(info.sha256)) {
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
    if (natives > 0) return;
    throw new Error(`Snapshot ${id} lists no restorable volumes to verify`);
  }
  const backupVolume = `${prefix}${BACKUP_VOLUME}`;
  const result = await runtime.oneShot({
    image: BACKUP_HELPER_IMAGE,
    mounts: [{ volume: backupVolume, target: '/backup', readOnly: true }],
    argv: ['sh', '-c', `cd /backup/${id} && ${checks.join('; ')}`],
  });
  if (!result.success) {
    throw new Error(
      `Snapshot ${id} failed integrity verification: ${result.stderr || result.stdout}`,
    );
  }
}
