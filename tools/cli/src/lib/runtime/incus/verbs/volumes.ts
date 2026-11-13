import { isIncusNameConflict, type IncusClient } from '@tale/incus/client';

import { preconditionError } from '../../../../utils/fail';
import { assertCustody, BACKUPS_VOLUME, custodyOf } from '../apply/readback';
import type { StackTarget, StackVolume } from '../compile/stack-target';
import { volumeConfig } from '../plan/plan';
import type { ImageFsFacts } from './image-facts-cache';

/**
 * The stack's volumes on Incus (design D-27): shifted custom volumes in the
 * stack project, named by their logical compose name with no prefix and
 * labelled `user.tale.stack`/`user.tale.volume`/`user.tale.kind`.
 *
 * A new volume's root gets the owner and mode of the path it is mounted at
 * in its user's image (`initial.uid/gid/mode`), read from the image facts —
 * never prefilled from the image (no `initial.copy`). Where the image lacks
 * the path, the volume is made root-owned 0755, which is what Docker makes
 * of a new named volume there, with a warning (main's images mount
 * `static-assets` and the sandbox's `platform-config` at paths they do not
 * hold, and their entrypoints take the directory over as root). A path the
 * image holds as a file or a symlink is refused: nothing can be mounted on
 * it.
 * A volume never moves between pools: a stack whose volumes live on another
 * pool than the declared one is refused, not copied.
 */

export interface VolumeOwner {
  uid: number;
  gid: number;
  /** Octal, `0755`. */
  mode: string;
}

export interface VolumeInfo {
  name: string;
  kind: 'data' | 'runtime';
  /** Names of the instances that mount it. */
  usedBy: string[];
}

const ROOT_OWNER: VolumeOwner = { uid: 0, gid: 0, mode: '0755' };

/** `/1.0/instances/<name>?project=…` → `<name>`. */
function instanceOfUrl(url: string): string {
  const path = url.split('?')[0] ?? '';
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

/** Where each volume of `target` is mounted: the instance, its image's
 * digest and the path, in the target's instance order. */
function volumeMounts(
  target: StackTarget,
): Map<string, { instance: string; digest: string; path: string }[]> {
  const digests = new Map(
    target.images.map((image) => [image.alias, image.digest]),
  );
  const mounts = new Map<
    string,
    { instance: string; digest: string; path: string }[]
  >();
  for (const instance of target.instances) {
    const digest = digests.get(instance.image);
    if (digest === undefined) continue;
    for (const device of Object.values(instance.devices)) {
      if (device.type !== 'disk' || device.path === '/' || !device.source)
        continue;
      const list = mounts.get(device.source) ?? [];
      list.push({ instance: instance.name, digest, path: device.path ?? '' });
      mounts.set(device.source, list);
    }
  }
  return mounts;
}

/** The mount points to read per image digest, for `imageFsFacts`. */
export function mountPointsByDigest(
  target: StackTarget,
): Map<string, string[]> {
  const byDigest = new Map<string, Set<string>>();
  for (const users of volumeMounts(target).values())
    for (const user of users) {
      const paths = byDigest.get(user.digest) ?? new Set<string>();
      paths.add(user.path);
      byDigest.set(user.digest, paths);
    }
  return new Map(
    [...byDigest].map(([digest, paths]) => [digest, [...paths].sort()]),
  );
}

/**
 * The owner each volume of `target` is made with. The first user in the
 * target's order whose image holds the mount point decides; another user
 * whose image owns the path otherwise is named in a warning. A volume no
 * user's image holds a directory for is made root-owned, with a warning.
 * Throws a refusal naming every mount point an image holds as a file or a
 * symlink.
 */
export function volumeOwners(
  target: StackTarget,
  facts: ReadonlyMap<string, ImageFsFacts>,
  warn: (line: string) => void = (line) => console.warn(line),
): Map<string, VolumeOwner> {
  const mounts = volumeMounts(target);
  const owners = new Map<string, VolumeOwner>();
  const refused: string[] = [];
  for (const volume of target.volumes) {
    const users = mounts.get(volume.name) ?? [];
    let owner: VolumeOwner | undefined;
    let decidedBy = '';
    const lacking: string[] = [];
    for (const user of users) {
      const record = facts.get(user.digest);
      if (record === undefined)
        throw new Error(
          `No image facts for ${user.digest}, which ${user.instance} runs.`,
        );
      const found = record.paths[user.path];
      if (found === undefined)
        throw new Error(
          `The image facts of ${user.digest} hold no ${user.path}.`,
        );
      if (found === null) {
        lacking.push(`${user.instance}:${user.path}`);
        continue;
      }
      if (found.type !== 'directory') {
        refused.push(
          `${volume.name} at ${user.path} in ${user.instance}: the image has a ${found.type} there`,
        );
        continue;
      }
      const candidate = { uid: found.uid, gid: found.gid, mode: found.mode };
      if (owner === undefined) {
        owner = candidate;
        decidedBy = `${user.instance}:${user.path}`;
      } else if (owner.uid !== candidate.uid || owner.gid !== candidate.gid)
        warn(
          `Volume ${volume.name} is made for ${decidedBy} (${owner.uid}:${owner.gid}); ${user.instance} expects ${user.path} as ${candidate.uid}:${candidate.gid}.`,
        );
    }
    if (owner !== undefined) owners.set(volume.name, owner);
    else if (users.length > 0) {
      owners.set(volume.name, ROOT_OWNER);
      if (volume.kind === 'data')
        warn(
          `Volume ${volume.name} is made root-owned (0755): no image holds its mount point (${lacking.join(', ')}), as Docker makes a new volume there.`,
        );
    }
  }
  if (refused.length > 0)
    throw preconditionError(
      `A volume is mounted where its image holds no directory:\n${refused.join('\n')}`,
      'Mount the volume at a directory of the image, or at a path the image does not hold.',
    );
  return owners;
}

/**
 * Refuse a stack whose volumes live on another pool than the declared one:
 * Incus cannot move a volume between pools in place, and a new empty volume
 * on the new pool would hide the data on the old one.
 */
export async function assertPoolUnchanged(
  client: IncusClient,
  target: Pick<StackTarget, 'stack' | 'pool'>,
): Promise<void> {
  const elsewhere = new Map<string, Set<string>>();
  for (const instance of await client.listInstances()) {
    if (instance.config['user.tale.stack'] !== target.stack) continue;
    for (const device of Object.values(instance.devices)) {
      if (
        device.type !== 'disk' ||
        device.path === '/' ||
        device.pool === undefined ||
        device.pool === target.pool
      )
        continue;
      const pools = elsewhere.get(device.source ?? '') ?? new Set<string>();
      pools.add(device.pool);
      elsewhere.set(device.source ?? '', pools);
    }
  }
  if (elsewhere.size === 0) return;
  const lines = [...elsewhere]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([volume, pools]) => `${volume} on ${[...pools].sort().join(', ')}`);
  throw preconditionError(
    `The stack ${target.stack} keeps volumes on another pool than ${target.pool}: ${lines.join('; ')}. A volume never moves between pools.`,
    'Declare the pool the volumes are on, or move the stack with tale backup and tale restore.',
  );
}

/**
 * Make each volume that is missing, with its labels and owner; keep one
 * that exists and is the stack's. Returns the names made.
 */
export async function ensureStackVolumes(
  client: IncusClient,
  target: Pick<StackTarget, 'stack' | 'pool'>,
  volumes: readonly StackVolume[],
  owners: ReadonlyMap<string, VolumeOwner>,
): Promise<string[]> {
  const created: string[] = [];
  for (const volume of volumes) {
    if (volume.pool !== target.pool)
      throw preconditionError(
        `Volume ${volume.name} is planned on pool ${volume.pool}, not the stack's ${target.pool}.`,
      );
    const config = volumeConfig(volume, target.stack);
    const existing = await client.getVolume(target.pool, volume.name);
    if (existing !== undefined) {
      assertCustody(
        'volume',
        volume.name,
        custodyOf(existing.config, target.stack),
        target.stack,
      );
      continue;
    }
    // A volume no service mounts (`backups`) keeps Incus's own root.
    const owner = owners.get(volume.name);
    try {
      await client.createVolume(target.pool, {
        name: volume.name,
        type: 'custom',
        content_type: 'filesystem',
        config: {
          ...config,
          ...(owner === undefined
            ? {}
            : {
                'initial.uid': String(owner.uid),
                'initial.gid': String(owner.gid),
                'initial.mode': owner.mode,
              }),
        },
      });
    } catch (error) {
      if (!isIncusNameConflict(error)) throw error;
      // Made meanwhile (another run, or an earlier attempt whose answer was
      // lost): it is judged like one that existed.
      const raced = await client.getVolume(target.pool, volume.name);
      if (raced === undefined) throw error;
      assertCustody(
        'volume',
        volume.name,
        custodyOf(raced.config, target.stack),
        target.stack,
      );
      continue;
    }
    created.push(volume.name);
  }
  return created;
}

/** The stack's volumes on `pool`, by name. */
export async function listStackVolumes(
  client: IncusClient,
  pool: string,
  stack: string,
): Promise<VolumeInfo[]> {
  return (await client.listVolumes(pool))
    .filter((volume) => volume.config['user.tale.stack'] === stack)
    .map((volume) => ({
      name: volume.name,
      kind:
        volume.config['user.tale.kind'] === 'runtime'
          ? ('runtime' as const)
          : ('data' as const),
      usedBy: volume.usedBy.map(instanceOfUrl).sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Delete one of the stack's volumes; false when there is none. A volume of
 * another stack, an unlabelled one, or one an instance uses is refused. */
export async function removeStackVolume(
  client: IncusClient,
  pool: string,
  stack: string,
  name: string,
): Promise<boolean> {
  const volume = await client.getVolume(pool, name);
  if (volume === undefined) return false;
  assertCustody('volume', name, custodyOf(volume.config, stack), stack);
  if (volume.usedBy.length > 0)
    throw preconditionError(
      `Volume ${name} is still used by ${volume.usedBy.map(instanceOfUrl).sort().join(', ')}.`,
      'Remove the instances that mount it first.',
    );
  if (name === BACKUPS_VOLUME)
    console.warn(
      `Deleting ${BACKUPS_VOLUME}: the snapshot manifests and archives it holds go with it.`,
    );
  return client.deleteVolume(pool, name);
}
