// Custom volumes beyond create and delete: rename, a disk device attached to
// or detached from an instance under an ETag precondition, and the pool's
// room for a restore's space check.
//
// Measured on Incus 7.6 (ZFS): renaming a DETACHED volume takes about 100 ms
// and moves its whole snapshot history with it. Renaming a volume attached to
// a stopped instance takes about 30 s and rewrites the instance's device
// source to the new name; attached to a running one it is refused. So a
// rename here refuses a volume anything uses: detach first.
//
// A volume the file API touched stays mounted by Incus for about 15 s after
// (measured on 7.6: a rename right after a volume file write failed "device
// or resource busy" for 15.7 s, then succeeded). A failed rename changed
// nothing, so a busy one is tried again until `busyWaitMs`.

import {
  devicesOf,
  IncusApiError,
  parsePoolResources,
  type IncusPoolResources,
} from './api.ts';
import type { IncusClient } from './client.ts';

const VOLUME_WAIT_MS = 120_000;
/** How long a rename waits out a volume Incus still holds mounted. */
const RENAME_BUSY_WAIT_MS = 45_000;
const RENAME_BUSY_PAUSE_MS = 1_000;

/** Incus's words for a volume still mounted (by its file API). */
export function isIncusVolumeBusy(error: unknown): boolean {
  return (
    error instanceof IncusApiError &&
    /device or resource busy/i.test(error.message)
  );
}

function volumePath(pool: string, name: string): string {
  return `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom/${encodeURIComponent(name)}`;
}

/** Renames a custom volume that no instance uses. A volume in use is
 * refused (409) before anything is asked of Incus. */
export async function renameVolume(
  client: IncusClient,
  pool: string,
  from: string,
  to: string,
  options: { waitMs?: number; busyWaitMs?: number; busyPauseMs?: number } = {},
): Promise<void> {
  const volume = await client.getVolume(pool, from);
  if (volume === undefined) {
    throw new IncusApiError(`Storage volume "${from}" not found`, 404);
  }
  if (volume.usedBy.length > 0) {
    throw new IncusApiError(
      `Storage volume "${from}" is attached to ${volume.usedBy.join(', ')}: detach it before a rename`,
      409,
    );
  }
  const deadline = Date.now() + (options.busyWaitMs ?? RENAME_BUSY_WAIT_MS);
  for (;;) {
    try {
      await client.operation('POST', volumePath(pool, from), {
        query: { project: client.project },
        json: { name: to },
        waitMs: options.waitMs ?? VOLUME_WAIT_MS,
      });
      return;
    } catch (error) {
      if (!isIncusVolumeBusy(error) || Date.now() >= deadline) throw error;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, options.busyPauseMs ?? RENAME_BUSY_PAUSE_MS),
      );
    }
  }
}

/** A custom volume's disk device, as an instance holds it. */
export interface DiskDevice {
  pool: string;
  /** The volume's name. */
  source: string;
  /** Where it is mounted inside the instance. */
  path: string;
  readonly?: boolean;
}

/** Attaches a custom volume to an instance as device `device`, if the
 * instance is still the one `ifMatch` was read from (412 otherwise). */
export async function attachDisk(
  client: IncusClient,
  instance: string,
  device: string,
  disk: DiskDevice,
  options: { ifMatch: string },
): Promise<void> {
  await client.patchInstance(
    instance,
    {
      devices: {
        [device]: {
          type: 'disk',
          pool: disk.pool,
          source: disk.source,
          path: disk.path,
          ...(disk.readonly === true ? { readonly: 'true' } : {}),
        },
      },
    },
    { ifMatch: options.ifMatch },
  );
}

/** Removes device `device` from an instance, if the instance is still the
 * one `ifMatch` was read from (412 otherwise). An instance PATCH merges
 * devices and cannot remove one, so this reads the instance and PUTs it
 * back without the device under the same ETag. False when the instance had
 * no such device. */
export async function detachDevice(
  client: IncusClient,
  instance: string,
  device: string,
  options: { ifMatch: string },
): Promise<boolean> {
  const path = `/1.0/instances/${encodeURIComponent(instance)}`;
  const reply = await client.send('GET', path, {
    query: { project: client.project },
    retry: true,
  });
  if (
    reply.etag === undefined ||
    reply.etag.replaceAll('"', '') !== options.ifMatch.replaceAll('"', '')
  ) {
    throw new IncusApiError(
      `Instance "${instance}" changed since it was read (ETag mismatch)`,
      412,
    );
  }
  let metadata: unknown;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(reply.body));
    metadata =
      parsed !== null && typeof parsed === 'object' && 'metadata' in parsed
        ? parsed.metadata
        : undefined;
  } catch (error) {
    throw new IncusApiError(
      `Incus answered GET ${path} with something that is not JSON`,
      502,
      { cause: error },
    );
  }
  if (metadata === null || typeof metadata !== 'object') {
    throw new IncusApiError(`Incus answered a malformed instance`, 502);
  }
  const raw = Object.fromEntries(Object.entries(metadata));
  const devices = devicesOf(raw.devices);
  if (!(device in devices)) return false;
  delete devices[device];
  await client.operation('PUT', path, {
    query: { project: client.project },
    json: {
      architecture: raw.architecture,
      config: raw.config,
      devices,
      ephemeral: raw.ephemeral,
      profiles: raw.profiles,
      stateful: raw.stateful,
      description: raw.description,
    },
    headers: { 'if-match': reply.etag },
    waitMs: VOLUME_WAIT_MS,
  });
  return true;
}

/** What a custom volume uses on its pool, and its quota (`size`) or the
 * pool's room where it has none (`GET …/volumes/custom/<name>/state`). */
export async function getVolumeUsage(
  client: IncusClient,
  pool: string,
  name: string,
): Promise<{ used: number; total: number }> {
  const raw = await client.sync('GET', `${volumePath(pool, name)}/state`, {
    query: { project: client.project },
    retry: true,
  });
  const usage =
    raw !== null && typeof raw === 'object' && 'usage' in raw
      ? raw.usage
      : undefined;
  const used =
    usage !== null && typeof usage === 'object' && 'used' in usage
      ? usage.used
      : undefined;
  const total =
    usage !== null && typeof usage === 'object' && 'total' in usage
      ? usage.total
      : undefined;
  if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0)
    throw new IncusApiError(
      `Incus answered the state of volume ${name} without its usage`,
      502,
    );
  return {
    used,
    total: typeof total === 'number' && Number.isSafeInteger(total) ? total : 0,
  };
}

/** The pool's used and total space and inodes. */
export async function getStoragePoolResources(
  client: IncusClient,
  pool: string,
): Promise<IncusPoolResources> {
  return parsePoolResources(
    await client.sync(
      'GET',
      `/1.0/storage-pools/${encodeURIComponent(pool)}/resources`,
      { retry: true },
    ),
  );
}
