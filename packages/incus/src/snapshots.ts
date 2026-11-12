// Native snapshots of custom volumes: create, list, delete, and a copy of a
// snapshot into a fresh volume (a restore never rolls a volume back in
// place: a ZFS rollback destroys every newer snapshot).
//
// Measured on Incus 7.6 (ZFS): a copy from a snapshot took 193 ms, kept
// `security.shifted`, carried no snapshots, and outlived the deletion of the
// snapshot it was copied from and of its whole volume.

import {
  IncusApiError,
  parseVolumeSnapshot,
  type IncusConfigMap,
  type IncusVolumeSnapshot,
} from './api.ts';
import type { IncusClient } from './client.ts';

const SNAPSHOT_WAIT_MS = 300_000;

function snapshotsPath(pool: string, volume: string): string {
  return `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom/${encodeURIComponent(volume)}/snapshots`;
}

/** A snapshot name Incus accepts and a path cannot misread. */
function checkSnapshotName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) {
    throw new Error(`Not a snapshot name: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Takes a snapshot of the volume and waits. */
export async function createVolumeSnapshot(
  client: IncusClient,
  pool: string,
  volume: string,
  name: string,
  options: { expiresAt?: Date; waitMs?: number } = {},
): Promise<void> {
  await client.operation('POST', snapshotsPath(pool, volume), {
    query: { project: client.project },
    json: {
      name: checkSnapshotName(name),
      ...(options.expiresAt === undefined
        ? {}
        : { expires_at: options.expiresAt.toISOString() }),
    },
    waitMs: options.waitMs ?? SNAPSHOT_WAIT_MS,
  });
}

/** The volume's snapshots, oldest first. */
export async function listVolumeSnapshots(
  client: IncusClient,
  pool: string,
  volume: string,
): Promise<IncusVolumeSnapshot[]> {
  const metadata = await client.sync('GET', snapshotsPath(pool, volume), {
    query: { project: client.project, recursion: '1' },
    retry: true,
  });
  if (!Array.isArray(metadata)) {
    throw new IncusApiError('Incus answered a malformed snapshot list', 502);
  }
  return metadata
    .map(parseVolumeSnapshot)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
}

/** Deletes one snapshot and waits; false when there was none (404). */
export async function deleteVolumeSnapshot(
  client: IncusClient,
  pool: string,
  volume: string,
  name: string,
  options: { waitMs?: number } = {},
): Promise<boolean> {
  try {
    await client.operation(
      'DELETE',
      `${snapshotsPath(pool, volume)}/${encodeURIComponent(checkSnapshotName(name))}`,
      {
        query: { project: client.project },
        waitMs: options.waitMs ?? SNAPSHOT_WAIT_MS,
      },
    );
    return true;
  } catch (error) {
    if (error instanceof IncusApiError && error.status === 404) return false;
    throw error;
  }
}

/** Copies snapshot `snapshot` of volume `from` into a new custom volume
 * `name` on the same pool, and waits. The new volume has no snapshots. */
export async function copyVolumeFromSnapshot(
  client: IncusClient,
  pool: string,
  from: { volume: string; snapshot: string },
  name: string,
  options: { config?: IncusConfigMap; waitMs?: number } = {},
): Promise<void> {
  await client.operation(
    'POST',
    `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom`,
    {
      query: { project: client.project },
      json: {
        name,
        type: 'custom',
        content_type: 'filesystem',
        // Without a config the copy keeps the source's (security.shifted).
        ...(options.config === undefined ? {} : { config: options.config }),
        source: {
          type: 'copy',
          pool,
          name: `${from.volume}/${checkSnapshotName(from.snapshot)}`,
        },
      },
      waitMs: options.waitMs ?? SNAPSHOT_WAIT_MS,
    },
  );
}
