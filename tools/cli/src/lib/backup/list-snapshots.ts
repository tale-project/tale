import { dockerRuntime } from '../runtime/docker/docker-runtime';
import { snapshotStoreOf } from '../runtime/incus/verbs/snapshots';
import type { StackRuntime } from '../runtime/types';
import { BACKUP_HELPER_IMAGE, BACKUP_VOLUME } from './constants';
import { parseManifest, type SnapshotManifest } from './manifest';

/**
 * Read every complete snapshot manifest from the project's backups volume,
 * newest first. Directories without a manifest (torn snapshots) and
 * manifests that fail validation are skipped with a warning. Returns []
 * when the backups volume does not exist yet. On Incus each snapshot's
 * newest manifest generation that parses is read through the volume file API
 * (R3-29).
 */
export async function listSnapshots(
  prefix: string,
  runtime: StackRuntime = dockerRuntime,
): Promise<SnapshotManifest[]> {
  const store = snapshotStoreOf(runtime);
  if (store !== null) return store.listManifests();
  const backupVolume = `${prefix}${BACKUP_VOLUME}`;
  if (!(await runtime.volumeExists(backupVolume))) {
    return [];
  }

  const result = await runtime.oneShot({
    image: BACKUP_HELPER_IMAGE,
    mounts: [{ volume: backupVolume, target: '/backup', readOnly: true }],
    argv: [
      'sh',
      '-c',
      // One single-line JSON manifest per line; `true` keeps the exit code 0
      // when the volume is empty (the glob then matches nothing).
      'for f in /backup/*/manifest.json; do [ -f "$f" ] && cat "$f" && echo; done; true',
    ],
  });
  if (!result.success) {
    throw new Error(
      `Failed to list snapshots in ${backupVolume}: ${result.stderr}`,
    );
  }

  const manifests: SnapshotManifest[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const manifest = parseManifest(trimmed);
    if (manifest) manifests.push(manifest);
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return manifests;
}
