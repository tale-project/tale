import { randomBytes } from 'node:crypto';

import { IncusApiError } from '@tale/incus/api';
import type { IncusClient } from '@tale/incus/client';
import {
  deleteFile,
  makeDirectory,
  readFile,
  readFileRange,
  statFile,
  writeFile,
  type IncusFileTarget,
} from '@tale/incus/files';
import {
  copyVolumeFromSnapshot,
  createVolumeSnapshot,
  deleteVolumeSnapshot,
  listVolumeSnapshots,
} from '@tale/incus/snapshots';
import { getProjectState } from '@tale/incus/state';
import { incusSizeBytes } from '@tale/incus/units';
import {
  attachDisk,
  detachDevice,
  getStoragePoolResources,
  getVolumeUsage,
  renameVolume,
} from '@tale/incus/volumes';

import { preconditionError } from '../../../../utils/fail';
import * as logger from '../../../../utils/logger';
import {
  isValidSnapshotId,
  restoreTargetVolume,
} from '../../../backup/constants';
import {
  hasArchive,
  manifestBytes,
  manifestFile,
  manifestGeneration,
  nativeSource,
  newestManifest,
  type SnapshotManifest,
  type SnapshotVolumeInfo,
} from '../../../backup/manifest';
import type {
  ExecResult,
  HealthState,
  NativeSnapshot,
  NativeSnapshotSet,
  OneShotJob,
  StackRuntime,
} from '../../types';
import { writeStackRecord } from '../apply/apply';
import {
  clearRestorePending,
  readJournal,
  restorePendingNotice,
  RESTORE_STEPS,
  setRestorePending,
  updateJournal,
  type RestorePending,
  type RestoreStep,
} from '../apply/journal';
import {
  assertCustody,
  BACKUPS_VOLUME,
  custodyOf,
  readStackRecord,
} from '../apply/readback';
import { RUNTIME_VOLUMES, type Healthcheck } from '../compile/translate';
import {
  declaredGrace,
  freezeStackInstances,
  startStackInstance,
  stopStackInstance,
  thawStackInstances,
} from './instances';

/**
 * Native snapshots on Incus (design D-28, D-28a, D-29, section 10).
 *
 * - **A set** is one native snapshot `tale-<id>` of each data volume, taken
 *   under one freeze of the volumes' running users. The freeze, snapshot and
 *   thaw calls of a set go out in parallel per phase (R3-16), so the users
 *   are held well under a second; after the thaw each user that was healthy
 *   is awaited until it is again, as Docker's pause is.
 * - **What a set holds** (D-28a, R-07): data volumes only. `backups`, a
 *   restore's holders and the CLI-owned volumes (`RUNTIME_VOLUMES`: the
 *   spawner's private key, the switch's and the resolvers' files, the bundle
 *   Caddyfile) are refused here, whatever the caller asks.
 * - **Manifests** live in `backups/<id>/manifest.<gen>.json` and are written
 *   by generation (R3-29), through the volume file API.
 * - **A restore** never rolls a volume back in place (D-29, R3-08): per
 *   volume, the users stop, the disk device is detached, `v` is renamed to
 *   its holder `v.pre-restore-<ts>` (which takes the snapshot history with
 *   it, so every manifest that names one of its snapshots is rewritten to
 *   the holder in the same step, R-06), the snapshot is copied into a fresh
 *   `v` (or an archive extracted into one), the device is attached again and
 *   the users start. Pool space and the project's pool quota are checked
 *   before anything changes, and every step is journaled as
 *   `restore-pending` (R3-22), which `resume` finishes and `abort` undoes.
 */

/** A restore's holder: `<v>.pre-restore-<YYYYMMDDHHMMSS>[-<n>]`. */
const HOLDER_PATTERN = /^(.+)\.pre-restore-(\d{14})(?:-(\d{1,3}))?$/;
/** How much more room than the copies' size a restore asks for. */
const SPACE_MARGIN = 1.1;
/** How big a piece of a file the chunked volume file API moves at once. */
export const FILE_CHUNK_BYTES = 8 * 1024 * 1024;
/** Clock slack between the CLI and Incus when a set's snapshot times are
 * judged against its freeze window. */
const FREEZE_SLACK_MS = 1_000;
const RECOVERY_POLL_MS = 1_000;
const RECOVERY_GRACE_MS = 5_000;

export interface SnapshotStoreOptions {
  client: IncusClient;
  pool: string;
  stack: string;
  stateRoot: string;
  /** The health of an instance (the CLI's own probes, D-24). */
  health: (name: string) => Promise<HealthState>;
  /** The healthcheck an instance declares, for its recovery window. */
  healthcheck: (name: string) => Healthcheck | { disabled: true } | undefined;
  /** A one-shot helper job (design D-30). */
  oneShot: (job: OneShotJob) => Promise<ExecResult>;
  /** The image a helper job names (Docker's field; Incus ignores it). */
  helperImage: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Called after each journaled restore step (tests: a crash there). */
  afterRestoreStep?: (volume: string, step: RestoreStep) => void;
}

interface Attachment {
  instance: string;
  device: string;
  path: string;
  readonly: boolean;
}

/** What one volume of a restore is restored from. */
type RestoreSource =
  | { kind: 'native'; entry: string; volume: string; snapshot: string }
  | { kind: 'archive'; entry: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return error instanceof IncusApiError && error.status === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  return error instanceof IncusApiError && error.status === 412;
}

/** `/1.0/instances/<name>?project=…` → `<name>`. */
function instanceOfUrl(url: string): string {
  const path = url.split('?')[0] ?? '';
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

/** Refuse a volume a snapshot set may never hold (D-28a, R-07). */
function assertSnapshotVolume(volume: string): void {
  if (volume in RUNTIME_VOLUMES)
    throw preconditionError(
      `${volume} is rendered by the CLI from the declaration (${RUNTIME_VOLUMES[volume as keyof typeof RUNTIME_VOLUMES]}) and is never snapshotted, archived or exported.`,
    );
  if (volume === BACKUPS_VOLUME)
    throw preconditionError(
      `${BACKUPS_VOLUME} holds the snapshots themselves and is never part of one.`,
    );
  if (HOLDER_PATTERN.test(volume))
    throw preconditionError(
      `${volume} holds what a restore replaced and is never part of a new snapshot.`,
    );
}

/** The holder name of `volume` for a restore started at `at`. */
export function holderName(
  volume: string,
  at: Date,
  taken: ReadonlySet<string>,
): string {
  const stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const base = `${volume}.pre-restore-${stamp}`;
  if (base.length > 63)
    throw preconditionError(`${volume} is too long a name to set aside.`);
  if (!taken.has(base)) return base;
  for (let n = 1; n < 1000; n += 1) {
    const name = `${base}-${n}`;
    if (!taken.has(name)) return name;
  }
  throw preconditionError(`No free holder name for ${volume}.`);
}

/** Where `backups` is, for the volume file API. */
function backupsTarget(pool: string): IncusFileTarget {
  return { pool, volume: BACKUPS_VOLUME };
}

/** A relative path inside a volume, for the volume file API. */
function volumePath(path: string): string {
  if (
    !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) ||
    path.split('/').includes('..')
  )
    throw new Error(`Not a file path inside a volume: ${JSON.stringify(path)}`);
  return `/${path}`;
}

export class IncusSnapshotStore {
  readonly client: IncusClient;
  readonly pool: string;
  readonly stack: string;
  readonly stateRoot: string;
  private readonly options: SnapshotStoreOptions;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(options: SnapshotStoreOptions) {
    this.options = options;
    this.client = options.client;
    this.pool = options.pool;
    this.stack = options.stack;
    this.stateRoot = options.stateRoot;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
  }

  // ---- volumes -----------------------------------------------------------

  /** The running instances that mount `volume`, by its `used_by`. */
  async volumeUsers(volume: string): Promise<string[]> {
    const found = await this.client.getVolume(this.pool, volume);
    if (found === undefined) return [];
    const users: string[] = [];
    for (const url of found.usedBy) {
      const name = instanceOfUrl(url);
      const read = await this.client.getInstance(name);
      if (read?.instance.status === 'Running') users.push(name);
    }
    return users.sort();
  }

  /** The stack's volume `name`, refused when it is another stack's. */
  private async stackVolume(name: string) {
    const volume = await this.client.getVolume(this.pool, name);
    if (volume === undefined) return undefined;
    assertCustody(
      'volume',
      name,
      custodyOf(volume.config, this.stack),
      this.stack,
    );
    return volume;
  }

  // ---- freeze ------------------------------------------------------------

  /**
   * Run `work` with every running user of `volumes` frozen; the freeze and
   * thaw calls go out in parallel (R3-16). A user whose health cannot be
   * read is refused before anything is frozen. After the thaw, each user
   * that was healthy (or starting) is awaited until it reports healthy
   * again, within its healthcheck's own window; one the freeze took from
   * healthy that does not recover fails the call, even though `work` did
   * not (the rule of `with-volume-paused.ts`).
   */
  async quiesce<T>(
    volumes: readonly string[],
    work: (frozenCount: number) => Promise<T>,
  ): Promise<T> {
    const names = new Set<string>();
    for (const volume of volumes)
      for (const user of await this.volumeUsers(volume)) names.add(user);
    const users = await Promise.all(
      [...names].sort().map(async (name) => {
        try {
          return { name, health: await this.options.health(name) };
        } catch (error) {
          throw preconditionError(
            `Failed to read the health of ${name} before freezing it for ${volumes.join(', ')}: ${errorText(error)}`,
          );
        }
      }),
    );
    const frozen: string[] = [];
    let value: T;
    try {
      const results = await Promise.allSettled(
        users.map(async ({ name }) => {
          await freezeStackInstances(this.client, [name]);
          frozen.push(name);
        }),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failed !== undefined)
        throw new Error(
          `Failed to freeze the users of ${volumes.join(', ')}: ${errorText(failed.reason)}`,
        );
      value = await work(frozen.length);
    } catch (error) {
      await this.thawAndRecover(users, frozen, false).catch(
        (cleanup: unknown) => {
          logger.error(
            `Thawing the frozen instances failed: ${errorText(cleanup)}`,
          );
        },
      );
      throw error;
    }
    await this.thawAndRecover(users, frozen, true);
    return value;
  }

  private async thawAndRecover(
    users: readonly { name: string; health: HealthState }[],
    frozen: readonly string[],
    enforce: boolean,
  ): Promise<void> {
    if (frozen.length === 0) return;
    try {
      await thawStackInstances(this.client, frozen);
    } catch (error) {
      logger.error(`Failed to thaw ${frozen.join(', ')}: ${errorText(error)}`);
      logger.error(
        `  Run manually: ${frozen.map((name) => `incus start ${name}`).join('; ')}`,
      );
      throw error;
    }
    const awaited = users.filter(
      (user) =>
        frozen.includes(user.name) &&
        (user.health === 'healthy' || user.health === 'starting'),
    );
    const failures: string[] = [];
    await Promise.all(
      awaited.map(async (user) => {
        const window = this.recoveryWindowMs(user.name);
        const deadline = this.now().getTime() + window;
        let health: HealthState = 'starting';
        for (;;) {
          try {
            health = await this.options.health(user.name);
          } catch (error) {
            logger.debug(
              `Health of ${user.name} unreadable: ${errorText(error)}`,
            );
          }
          if (health === 'healthy' || this.now().getTime() >= deadline) break;
          await this.sleep(RECOVERY_POLL_MS);
        }
        if (health === 'healthy') return;
        const summary = `${user.name} did not report healthy again within ${Math.ceil(window / 1000)}s of being thawed (health: ${health}).`;
        if (enforce && user.health === 'healthy') failures.push(summary);
        else logger.warn(summary);
      }),
    );
    if (failures.length > 0) throw new Error(failures.join(' '));
  }

  /** Docker's tolerance for a freshly monitored container: `retries`
   * probes, each up to interval + timeout, plus slack. */
  private recoveryWindowMs(name: string): number {
    const check = this.options.healthcheck(name);
    if (check === undefined || 'disabled' in check) return RECOVERY_GRACE_MS;
    return (
      Math.max(check.retries, 1) * (check.intervalMs + check.timeoutMs) +
      RECOVERY_GRACE_MS
    );
  }

  // ---- snapshot sets -----------------------------------------------------

  /**
   * Take native snapshot `name` of each of `volumes` under one freeze of
   * their users. A set that fails part-way deletes the snapshots it took.
   */
  async snapshot(
    volumes: readonly string[],
    name: string,
  ): Promise<NativeSnapshotSet> {
    for (const volume of volumes) assertSnapshotVolume(volume);
    if (volumes.length === 0) throw new Error('A snapshot set needs a volume.');
    const notice = restorePendingNotice(await readJournal(this.stateRoot));
    if (notice !== null)
      throw preconditionError(`${notice} A new snapshot waits until it is.`, [
        'tale restore --resume   (finish the restore)',
        'tale restore --abort    (put the volumes back as they were)',
      ]);
    const sizes = await Promise.all(
      volumes.map(async (volume) => {
        const found = await this.stackVolume(volume);
        if (found === undefined)
          throw preconditionError(
            `The stack has no volume ${volume} to snapshot.`,
          );
        const usage = await getVolumeUsage(this.client, this.pool, volume);
        return {
          volume,
          usedBytes: usage.used,
          quotaBytes: incusSizeBytes(found.config.size ?? '') ?? 0,
        };
      }),
    );
    let startedAt = '';
    let endedAt = '';
    const taken: string[] = [];
    try {
      const frozenCount = await this.quiesce(volumes, async (count) => {
        startedAt = this.now().toISOString();
        const results = await Promise.allSettled(
          volumes.map(async (volume) => {
            await createVolumeSnapshot(this.client, this.pool, volume, name);
            taken.push(volume);
          }),
        );
        endedAt = this.now().toISOString();
        const failed = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        if (failed !== undefined)
          throw new Error(
            `A snapshot of the set ${name} failed: ${errorText(failed.reason)}`,
          );
        return count;
      });
      const snapshots: NativeSnapshot[] = await Promise.all(
        sizes.map(async (size) => {
          const found = (
            await listVolumeSnapshots(this.client, this.pool, size.volume)
          ).find((snapshot) => snapshot.name === name);
          if (found === undefined || found.createdAtMs === 0)
            throw new Error(
              `Snapshot ${name} of ${size.volume} did not read back.`,
            );
          return {
            volume: size.volume,
            snapshot: name,
            createdAt: new Date(found.createdAtMs).toISOString(),
            usedBytes: size.usedBytes,
            quotaBytes: size.quotaBytes,
          };
        }),
      );
      return { snapshots, freeze: { startedAt, endedAt }, frozenCount };
    } catch (error) {
      await Promise.allSettled(
        taken.map((volume) =>
          deleteVolumeSnapshot(this.client, this.pool, volume, name).catch(
            (cleanup: unknown) => {
              logger.warn(
                `Could not delete the partial snapshot ${volume}/${name}: ${errorText(cleanup)}`,
              );
            },
          ),
        ),
      );
      throw error;
    }
  }

  /** Delete one native snapshot; false when it was gone. */
  deleteNativeSnapshot(volume: string, snapshot: string): Promise<boolean> {
    return deleteVolumeSnapshot(this.client, this.pool, volume, snapshot).catch(
      (error: unknown) => {
        if (isNotFound(error)) return false;
        throw error;
      },
    );
  }

  /**
   * Copy `source` into a scratch volume, run `work` on its name, and delete
   * it: what an archive is written from, so the live volume is never read
   * while it changes and its users are never frozen for a tar.
   */
  async withSnapshotCopy<T>(
    source: { volume: string; snapshot: string },
    work: (scratch: string) => Promise<T>,
  ): Promise<T> {
    const base = source.volume.replace(HOLDER_PATTERN, '$1').slice(0, 40);
    const scratch = `${base}.archive-${randomBytes(4).toString('hex')}`;
    await this.copySnapshot(source, scratch);
    try {
      return await work(scratch);
    } finally {
      try {
        await this.client.deleteVolume(this.pool, scratch);
      } catch (error) {
        logger.warn(
          `The scratch volume ${scratch} could not be deleted: ${errorText(error)}. Delete it by hand: incus storage volume delete ${this.pool} ${scratch}`,
        );
      }
    }
  }

  /**
   * Copy a snapshot into a new volume `name` with the snapshot's own
   * configuration, `size` included: a project with a pool quota refuses a
   * copy that names none (measured on Incus 7.6: "has no size config set"),
   * however the source was made.
   */
  private async copySnapshot(
    source: { volume: string; snapshot: string },
    name: string,
  ): Promise<void> {
    const snapshot = (
      await listVolumeSnapshots(this.client, this.pool, source.volume)
    ).find((candidate) => candidate.name === source.snapshot);
    if (snapshot === undefined)
      throw new Error(
        `There is no snapshot ${source.volume}/${source.snapshot} to copy.`,
      );
    const config = Object.fromEntries(
      Object.entries(snapshot.config).filter(
        ([key]) => !key.startsWith('volatile.'),
      ),
    );
    if (config.size === undefined) {
      const size = (await this.client.getVolume(this.pool, source.volume))
        ?.config.size;
      if (size !== undefined) config.size = size;
    }
    await copyVolumeFromSnapshot(this.client, this.pool, source, name, {
      config,
    });
  }

  /**
   * Whether each native snapshot of `manifest` exists where it says, with
   * the time it was recorded with, and all inside its freeze window: their
   * spread is at most the window's length (the server's clock against the
   * CLI's own, so only the spread is compared). Returns the problems.
   */
  async verifyNative(manifest: SnapshotManifest): Promise<string[]> {
    const problems: string[] = [];
    const times: number[] = [];
    for (const [volume, info] of Object.entries(manifest.volumes)) {
      const source = nativeSource(volume, info);
      if (source === null || info.native === undefined) continue;
      let found;
      try {
        found = (
          await listVolumeSnapshots(this.client, this.pool, source.volume)
        ).find((snapshot) => snapshot.name === source.snapshot);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (found === undefined) {
        // A reset deletes the native snapshots with their volumes and keeps
        // the archive it wrote first (R-05): the archive restores, and its
        // sha256 is checked beside this.
        if (hasArchive(info)) {
          logger.debug(
            `${volume}: native snapshot ${source.volume}/${source.snapshot} is gone; its archive stands in.`,
          );
          continue;
        }
        problems.push(
          `${volume}: native snapshot ${source.volume}/${source.snapshot} is MISSING`,
        );
        continue;
      }
      const recorded = Date.parse(info.native.createdAt);
      if (Math.abs(found.createdAtMs - recorded) > FREEZE_SLACK_MS)
        problems.push(
          `${volume}: native snapshot ${source.volume}/${source.snapshot} was taken at ${new Date(found.createdAtMs).toISOString()}, not ${info.native.createdAt} as recorded`,
        );
      times.push(found.createdAtMs);
    }
    if (manifest.freeze !== undefined && times.length > 1) {
      const window =
        Date.parse(manifest.freeze.endedAt) -
        Date.parse(manifest.freeze.startedAt);
      const spread = Math.max(...times) - Math.min(...times);
      if (spread > window + FREEZE_SLACK_MS)
        problems.push(
          `the native snapshots span ${spread} ms, longer than the ${window} ms freeze they were taken in`,
        );
    }
    return problems;
  }

  /** Whether Incus holds the native snapshot `source`. */
  private async nativeExists(source: {
    volume: string;
    snapshot: string;
  }): Promise<boolean> {
    try {
      return (
        await listVolumeSnapshots(this.client, this.pool, source.volume)
      ).some((snapshot) => snapshot.name === source.snapshot);
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * What `entry` of snapshot `id` restores from: its native snapshot while
   * Incus holds it, else its archive (a reset deleted the snapshots with
   * their volumes and kept the archive, R-05); null when it has neither.
   */
  private async restoreSource(
    entry: string,
    info: SnapshotVolumeInfo,
  ): Promise<RestoreSource | null> {
    const native = nativeSource(entry, info);
    if (native !== null && (await this.nativeExists(native)))
      return { kind: 'native', entry, ...native };
    if (hasArchive(info)) return { kind: 'archive', entry };
    return null;
  }

  // ---- manifests (R3-29) -------------------------------------------------

  /** The snapshot directories in `backups`. */
  async snapshotDirectories(): Promise<string[]> {
    if ((await this.client.getVolume(this.pool, BACKUPS_VOLUME)) === undefined)
      return [];
    const root = await readFile(this.client, backupsTarget(this.pool), '/');
    if (root?.type !== 'directory') return [];
    return root.entries.filter(isValidSnapshotId).sort();
  }

  /** The manifest files of one snapshot directory, by generation. */
  private async manifestFiles(
    id: string,
  ): Promise<{ name: string; generation: number }[]> {
    const dir = await readFile(this.client, backupsTarget(this.pool), `/${id}`);
    if (dir?.type !== 'directory') return [];
    return dir.entries.flatMap((name) => {
      const generation = manifestGeneration(name);
      return generation === null ? [] : [{ name, generation }];
    });
  }

  /** The newest verified manifest of `id`, with its generation; null when
   * the directory holds none (a torn snapshot). */
  async readManifest(
    id: string,
  ): Promise<{ manifest: SnapshotManifest; generation: number } | null> {
    if (!isValidSnapshotId(id)) throw new Error(`Invalid snapshot id: ${id}`);
    const files = await this.manifestFiles(id);
    const generations = await Promise.all(
      files.map(async (file) => {
        const entry = await readFile(
          this.client,
          backupsTarget(this.pool),
          `/${id}/${file.name}`,
          { maxBytes: 1024 * 1024 },
        );
        return {
          generation: file.generation,
          text:
            entry?.type === 'file'
              ? new TextDecoder().decode(entry.content)
              : null,
        };
      }),
    );
    return newestManifest(id, generations);
  }

  /** Every complete snapshot, newest first. */
  async listManifests(): Promise<SnapshotManifest[]> {
    const manifests: SnapshotManifest[] = [];
    for (const id of await this.snapshotDirectories()) {
      const read = await this.readManifest(id);
      if (read !== null) manifests.push(read.manifest);
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The directories without a manifest (torn snapshots). */
  async manifestlessDirectories(): Promise<string[]> {
    const torn: string[] = [];
    for (const id of await this.snapshotDirectories())
      if ((await this.manifestFiles(id)).length === 0) torn.push(id);
    return torn;
  }

  /**
   * Write `manifest` as a new generation, read it back and compare, then
   * delete the generations before it. A crash at any point leaves the
   * previous generation, or the new one, in force.
   */
  async writeManifest(manifest: SnapshotManifest): Promise<void> {
    const bytes = manifestBytes(manifest);
    const target = backupsTarget(this.pool);
    await makeDirectory(this.client, target, `/${manifest.id}`, {
      uid: 0,
      gid: 0,
      mode: '0700',
    });
    const existing = await this.manifestFiles(manifest.id);
    const generation =
      Math.max(0, ...existing.map((file) => file.generation)) + 1;
    const path = `/${manifest.id}/${manifestFile(generation)}`;
    await writeFile(this.client, target, path, bytes, {
      uid: 0,
      gid: 0,
      mode: '0600',
    });
    const back = await readFile(this.client, target, path, {
      maxBytes: 1024 * 1024,
    });
    if (
      back?.type !== 'file' ||
      Buffer.compare(Buffer.from(back.content), Buffer.from(bytes)) !== 0
    )
      throw new Error(`The snapshot manifest ${path} did not read back.`);
    for (const file of existing)
      await deleteFile(this.client, target, `/${manifest.id}/${file.name}`);
  }

  /** Delete one snapshot directory with everything in it. */
  async deleteSnapshotDirectory(id: string): Promise<void> {
    if (!isValidSnapshotId(id)) throw new Error(`Invalid snapshot id: ${id}`);
    const target = backupsTarget(this.pool);
    const remove = async (path: string): Promise<void> => {
      if ((await statFile(this.client, target, path))?.type === 'directory') {
        const entry = await readFile(this.client, target, path);
        if (entry?.type === 'directory')
          for (const child of entry.entries) await remove(`${path}/${child}`);
      }
      await deleteFile(this.client, target, path);
    };
    await remove(`/${id}`);
  }

  /** Rewrite every manifest that names a snapshot on `from` to name `to`
   * (the rename's history move, R-06); `to === volume` drops the field. */
  async moveManifestReferences(from: string, to: string): Promise<void> {
    for (const id of await this.snapshotDirectories()) {
      const read = await this.readManifest(id);
      if (read === null) continue;
      let changed = false;
      const volumes = structuredClone(read.manifest.volumes);
      for (const [volume, info] of Object.entries(volumes)) {
        const source = nativeSource(volume, info);
        if (
          source === null ||
          info.native === undefined ||
          source.volume !== from
        )
          continue;
        if (to === volume) delete info.native.volume;
        else info.native.volume = to;
        changed = true;
      }
      if (changed) await this.writeManifest({ ...read.manifest, volumes });
    }
  }

  // ---- reset (R-05, R3-22) -----------------------------------------------

  /** The stack's data volumes a reset deletes: never `backups`, a
   * restore's holder or a volume the CLI renders. */
  async dataVolumes(): Promise<string[]> {
    return (await this.client.listVolumes(this.pool))
      .filter(
        (volume) =>
          volume.config['user.tale.stack'] === this.stack &&
          volume.config['user.tale.kind'] !== 'runtime' &&
          !(volume.name in RUNTIME_VOLUMES) &&
          volume.name !== BACKUPS_VOLUME &&
          !HOLDER_PATTERN.test(volume.name),
      )
      .map((volume) => volume.name)
      .sort();
  }

  /** Record in `backups/stack.json` that the stack was reset, so the next
   * deploy may create its data volumes again (R3-22). */
  async recordReset(): Promise<void> {
    const record = await readStackRecord(this.client, this.pool, this.stack);
    await writeStackRecord(this.client, this.pool, {
      schemaVersion: 1,
      stack: this.stack,
      ...(record?.deployedAt === undefined
        ? {}
        : { deployedAt: record.deployedAt }),
      resetAt: this.now().toISOString(),
    });
  }

  // ---- holders -----------------------------------------------------------

  /** The stack's restore holders, with the snapshots manifests still name
   * on each (oldest first). */
  async holders(
    manifests?: readonly SnapshotManifest[],
  ): Promise<
    { volume: string; of: string; referencedBy: string[]; usedBy: string[] }[]
  > {
    const all = manifests ?? (await this.listManifests());
    const holders = [];
    for (const volume of await this.client.listVolumes(this.pool)) {
      const match = HOLDER_PATTERN.exec(volume.name);
      if (match === null || volume.config['user.tale.stack'] !== this.stack)
        continue;
      const referencedBy = all
        .filter((manifest) =>
          Object.entries(manifest.volumes).some(
            ([name, info]) => nativeSource(name, info)?.volume === volume.name,
          ),
        )
        .map((manifest) => manifest.id)
        .sort();
      holders.push({
        volume: volume.name,
        of: match[1] ?? '',
        referencedBy,
        usedBy: volume.usedBy.map(instanceOfUrl).sort(),
      });
    }
    return holders.sort((a, b) => a.volume.localeCompare(b.volume));
  }

  /** Delete the holders no manifest and no pending restore names any more;
   * returns their names. One a manifest still references is never deleted. */
  async deleteUnreferencedHolders(
    manifests?: readonly SnapshotManifest[],
  ): Promise<string[]> {
    const pending = (await readJournal(this.stateRoot))?.restorePending;
    const protectedHolders = new Set(Object.values(pending?.holders ?? {}));
    const deleted: string[] = [];
    for (const holder of await this.holders(manifests)) {
      if (
        holder.referencedBy.length > 0 ||
        holder.usedBy.length > 0 ||
        protectedHolders.has(holder.volume)
      )
        continue;
      if (await this.client.deleteVolume(this.pool, holder.volume))
        deleted.push(holder.volume);
    }
    return deleted;
  }

  /**
   * Delete the stack's `tale-<id>` snapshots no manifest names that are
   * older than `before` (a set a crash cut off before its manifest); the
   * snapshots of a run still in progress are newer and kept. Returns them.
   */
  async deleteOrphanSnapshots(
    manifests: readonly SnapshotManifest[],
    before: string,
  ): Promise<string[]> {
    const named = new Set<string>();
    for (const manifest of manifests)
      for (const [volume, info] of Object.entries(manifest.volumes)) {
        const source = nativeSource(volume, info);
        if (source !== null) named.add(`${source.volume}/${source.snapshot}`);
      }
    // A set whose directory holds any manifest file is never an orphan, even
    // when no generation of it parses here (a newer CLI's, or one torn by a
    // crash mid-write): only a set cut off before its first manifest is.
    const withManifest = new Set<string>();
    for (const id of await this.snapshotDirectories())
      if ((await this.manifestFiles(id)).length > 0) withManifest.add(id);
    const cutoff = Date.parse(before);
    const deleted: string[] = [];
    for (const volume of await this.client.listVolumes(this.pool)) {
      if (volume.config['user.tale.stack'] !== this.stack) continue;
      for (const snapshot of await listVolumeSnapshots(
        this.client,
        this.pool,
        volume.name,
      )) {
        const key = `${volume.name}/${snapshot.name}`;
        const id = snapshot.name.slice('tale-'.length);
        if (
          !snapshot.name.startsWith('tale-') ||
          !isValidSnapshotId(id) ||
          named.has(key) ||
          withManifest.has(id) ||
          snapshot.createdAtMs === 0 ||
          snapshot.createdAtMs >= cutoff
        )
          continue;
        if (await this.deleteNativeSnapshot(volume.name, snapshot.name))
          deleted.push(key);
      }
    }
    return deleted;
  }

  // ---- chunked volume files ----------------------------------------------

  /** Stream a file of `volume` out in pieces (HTTP range reads). */
  async readVolumeFile(
    volume: string,
    path: string,
    onChunk: (chunk: Uint8Array) => void | Promise<void>,
  ): Promise<void> {
    const target: IncusFileTarget = { pool: this.pool, volume };
    const absolute = volumePath(path);
    let offset = 0;
    for (;;) {
      const piece = await readFileRange(
        this.client,
        target,
        absolute,
        offset,
        FILE_CHUNK_BYTES,
      );
      if (piece === undefined)
        throw new Error(`There is no ${path} in ${volume}.`);
      if (piece.bytes.byteLength > 0) await onChunk(piece.bytes);
      offset += piece.bytes.byteLength;
      if (offset >= piece.size || piece.bytes.byteLength === 0) {
        if (offset !== piece.size)
          throw new Error(
            `${path} in ${volume} read ${offset} of ${piece.size} bytes.`,
          );
        return;
      }
    }
  }

  /** Write a file of `volume` from `chunks`: the first piece made anew,
   * root-owned 0600, the rest appended. */
  async writeVolumeFile(
    volume: string,
    path: string,
    chunks: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const target: IncusFileTarget = { pool: this.pool, volume };
    const absolute = volumePath(path);
    const parts = absolute.split('/').slice(1, -1);
    for (let index = 1; index <= parts.length; index += 1)
      await makeDirectory(
        this.client,
        target,
        `/${parts.slice(0, index).join('/')}`,
        {
          uid: 0,
          gid: 0,
          mode: '0700',
        },
      );
    let first = true;
    let buffered: Uint8Array[] = [];
    let size = 0;
    const flush = async () => {
      if (!first && size === 0) return;
      await writeFile(this.client, target, absolute, Buffer.concat(buffered), {
        uid: 0,
        gid: 0,
        mode: '0600',
        write: first ? 'overwrite' : 'append',
      });
      first = false;
      buffered = [];
      size = 0;
    };
    for await (const chunk of chunks) {
      buffered.push(chunk);
      size += chunk.byteLength;
      if (size >= FILE_CHUNK_BYTES) await flush();
    }
    await flush();
  }

  // ---- restore (D-29, R3-08, R3-22) --------------------------------------

  /** Restore `entries` of snapshot `id` into fresh volumes. */
  async restore(id: string, entries: readonly string[]): Promise<void> {
    const journal = await readJournal(this.stateRoot);
    if (journal?.restorePending)
      throw preconditionError(
        `A restore of snapshot ${journal.restorePending.id} is not finished.`,
        [
          'tale restore --resume   (finish it)',
          'tale restore --abort    (put the volumes back as they were)',
        ],
      );
    const read = await this.readManifest(id);
    if (read === null)
      throw preconditionError(
        `Snapshot ${id} has no manifest in ${BACKUPS_VOLUME}.`,
      );
    const sources = new Map<string, RestoreSource>();
    for (const entry of entries) {
      const info = read.manifest.volumes[entry];
      if (info === undefined)
        throw preconditionError(`Snapshot ${id} holds no ${entry}.`);
      const volume = restoreTargetVolume(entry);
      assertSnapshotVolume(volume);
      const native = nativeSource(entry, info);
      const source = await this.restoreSource(entry, info);
      if (source === null)
        throw preconditionError(
          `Snapshot ${id} names ${native?.volume ?? entry}/${native?.snapshot ?? ''} for ${volume}, and Incus holds no such snapshot.`,
        );
      if (source.kind === 'archive' && native !== null)
        logger.info(
          `${volume}: the native snapshot ${native.volume}/${native.snapshot} is gone; restoring from ${entry}.tar.gz.`,
        );
      sources.set(volume, source);
    }
    const volumes = [...sources.keys()];
    if (volumes.length === 0)
      throw preconditionError(`Snapshot ${id} restores no volume.`);

    // Everything is checked before the first change: the sources exist, the
    // live volumes are the stack's, and there is room for every copy.
    const instances = await this.client.listInstances();
    const attachments: Record<string, Attachment[]> = {};
    for (const volume of volumes) {
      const live = await this.stackVolume(volume);
      if (live === undefined)
        throw preconditionError(
          `The stack has no volume ${volume} to restore into.`,
          'Deploy the stack once, then restore.',
        );
      attachments[volume] = instances.flatMap((instance) =>
        Object.entries(instance.devices).flatMap(([device, spec]) =>
          spec.type === 'disk' &&
          spec.source === volume &&
          (spec.pool ?? this.pool) === this.pool
            ? [
                {
                  instance: instance.name,
                  device,
                  path: spec.path ?? '',
                  readonly: spec.readonly === 'true',
                },
              ]
            : [],
        ),
      );
    }
    await this.checkRoom(id, read.manifest, sources);

    const running = [
      ...new Set(
        Object.values(attachments)
          .flat()
          .map((attachment) => attachment.instance),
      ),
    ]
      .filter(
        (name) =>
          instances.find((instance) => instance.name === name)?.status ===
          'Running',
      )
      .sort();
    const taken = new Set(
      (await this.client.listVolumes(this.pool)).map((volume) => volume.name),
    );
    const at = this.now();
    const pending: RestorePending = {
      id,
      startedAt: at.toISOString(),
      volumes,
      steps: Object.fromEntries(volumes.map((volume) => [volume, 'pending'])),
      holders: Object.fromEntries(
        volumes.map((volume) => [volume, holderName(volume, at, taken)]),
      ),
      attachments,
      running,
    };
    await setRestorePending(this.stateRoot, this.stack, pending);
    await this.finish();
  }

  /**
   * Pool space and the project's quota against every copy, before anything
   * changes (R3-22): each must exceed the copies' size plus 10 %. A value
   * the certificate cannot read is a refusal that names it.
   */
  private async checkRoom(
    id: string,
    manifest: SnapshotManifest,
    sources: ReadonlyMap<string, RestoreSource>,
  ): Promise<void> {
    let used = 0;
    let quota = 0;
    for (const [volume, source] of sources) {
      const info = manifest.volumes[source.entry];
      if (source.kind === 'native' && info?.native !== undefined) {
        used += info.native.usedBytes;
        quota += info.native.quotaBytes;
        continue;
      }
      let usage;
      try {
        usage = await getVolumeUsage(this.client, this.pool, volume);
      } catch (error) {
        throw preconditionError(
          `Refusing to restore ${id}: the usage of volume ${volume} (GET /1.0/storage-pools/${this.pool}/volumes/custom/${volume}/state) could not be read: ${errorText(error)}`,
        );
      }
      used += Math.max(usage.used, info?.sizeBytes ?? 0);
      const live = await this.client.getVolume(this.pool, volume);
      quota += incusSizeBytes(live?.config.size ?? '') ?? 0;
    }
    const needSpace = Math.ceil(used * SPACE_MARGIN);
    const needQuota = Math.ceil(quota * SPACE_MARGIN);
    let free: number;
    try {
      const resources = await getStoragePoolResources(this.client, this.pool);
      free = resources.space.total - resources.space.used;
    } catch (error) {
      throw preconditionError(
        `Refusing to restore ${id}: the free space of pool ${this.pool} (GET /1.0/storage-pools/${this.pool}/resources) could not be read: ${errorText(error)}`,
        'Grant the certificate the pool read, or restore as an operator who can.',
      );
    }
    if (free < needSpace)
      throw preconditionError(
        `Refusing to restore ${id}: pool ${this.pool} has ${free} bytes free, and the copies need ${needSpace} (their ${used} bytes plus 10 %). Nothing was changed.`,
        'Free space on the pool, or delete old snapshots (tale backup prune), then restore again.',
      );
    let state;
    try {
      state = await getProjectState(this.client);
    } catch (error) {
      throw preconditionError(
        `Refusing to restore ${id}: the project's disk quota (GET /1.0/projects/${this.client.project}/state) could not be read: ${errorText(error)}`,
      );
    }
    for (const key of [`disk.${this.pool}`, 'disk']) {
      const resource = state.resources[key];
      if (resource === undefined || resource.limit < 0) continue;
      const left = resource.limit - resource.usage;
      if (left < needQuota)
        throw preconditionError(
          `Refusing to restore ${id}: the project ${this.client.project} has ${left} bytes left of its ${key === 'disk' ? 'limits.disk' : `limits.disk.pool.${this.pool}`} quota, and the copies count ${needQuota} against it (their sizes plus 10 %). Nothing was changed.`,
          'Raise the quota, or delete what holds it, then restore again.',
        );
    }
  }

  private async pending(): Promise<RestorePending> {
    const pending = (await readJournal(this.stateRoot))?.restorePending;
    if (!pending)
      throw preconditionError(
        'No restore is pending: there is nothing to finish or undo.',
      );
    return pending;
  }

  /** Stop each user that still runs, all at once, each within its own
   * declared grace. */
  private async stopUsers(names: readonly string[]): Promise<void> {
    await Promise.all(
      names.map(async (name) => {
        const read = await this.client.getInstance(name);
        if (read === undefined || read.instance.status === 'Stopped') return;
        logger.step(`Stopping ${name}...`);
        await stopStackInstance(
          this.client,
          name,
          declaredGrace(read.instance.config),
        );
      }),
    );
  }

  private async step(volume: string, step: RestoreStep): Promise<void> {
    await updateJournal(this.stateRoot, this.stack, (journal) => {
      if (journal.restorePending) journal.restorePending.steps[volume] = step;
    });
    this.options.afterRestoreStep?.(volume, step);
  }

  /** Finish the pending restore from the step each volume reached. */
  async finish(): Promise<void> {
    const pending = await this.pending();
    const order = (step: RestoreStep) => RESTORE_STEPS.indexOf(step);
    const at = (volume: string) => pending.steps[volume] ?? 'pending';
    if (
      pending.volumes.some((volume) => order(at(volume)) < order('stopped'))
    ) {
      await this.stopUsers(pending.running ?? []);
      for (const volume of pending.volumes)
        if (order(at(volume)) < order('stopped')) {
          await this.step(volume, 'stopped');
          pending.steps[volume] = 'stopped';
        }
    }
    const read = await this.readManifest(pending.id);
    if (read === null)
      throw preconditionError(
        `Snapshot ${pending.id} has no manifest any more.`,
      );
    for (const volume of pending.volumes) {
      const holder = pending.holders[volume];
      if (holder === undefined)
        throw new Error(`restore-pending has no holder for ${volume}`);
      const attachments = pending.attachments?.[volume] ?? [];
      if (at(volume) === 'stopped') {
        for (const attachment of attachments)
          await this.detach(attachment, volume);
        await this.step(volume, 'detached');
        pending.steps[volume] = 'detached';
      }
      if (at(volume) === 'detached') {
        const live = await this.client.getVolume(this.pool, volume);
        const aside = await this.client.getVolume(this.pool, holder);
        if (live !== undefined && aside === undefined) {
          logger.step(`Setting ${volume} aside as ${holder}...`);
          await renameVolume(this.client, this.pool, volume, holder);
        } else if (aside === undefined)
          throw new Error(`Neither ${volume} nor its holder ${holder} exists.`);
        // The history moved with the volume: the manifests follow it.
        await this.moveManifestReferences(volume, holder);
        await this.step(volume, 'renamed');
        pending.steps[volume] = 'renamed';
      }
      if (at(volume) === 'renamed') {
        if ((await this.client.getVolume(this.pool, volume)) !== undefined) {
          // A copy a crash cut short: never trusted, made again.
          await this.client.deleteVolume(this.pool, volume);
        }
        await this.copyInto(pending.id, volume, holder);
        await this.step(volume, 'copied');
        pending.steps[volume] = 'copied';
      }
      if (at(volume) === 'copied') {
        for (const attachment of attachments)
          await this.attach(attachment, volume);
        await this.step(volume, 'attached');
        pending.steps[volume] = 'attached';
      }
    }
    for (const name of pending.running ?? []) {
      logger.step(`Starting ${name}...`);
      await startStackInstance(this.client, name);
    }
    for (const volume of pending.volumes)
      if (at(volume) !== 'started') await this.step(volume, 'started');
    await clearRestorePending(this.stateRoot, this.stack);
    logger.info(
      `Set aside: ${pending.volumes.map((volume) => `${volume} -> ${pending.holders[volume]}`).join(', ')} (kept until no snapshot on them is listed; see tale backup prune).`,
    );
  }

  /** Fill the fresh `volume` from the snapshot (now on `holder`, or an
   * older holder) or from its archive. */
  private async copyInto(
    id: string,
    volume: string,
    holder: string,
  ): Promise<void> {
    const read = await this.readManifest(id);
    if (read === null)
      throw new Error(`Snapshot ${id} has no manifest any more.`);
    const entry =
      read.manifest.volumes[volume] !== undefined
        ? volume
        : Object.keys(read.manifest.volumes).find(
            (key) => restoreTargetVolume(key) === volume,
          );
    const info = entry === undefined ? undefined : read.manifest.volumes[entry];
    if (entry === undefined || info === undefined)
      throw new Error(`Snapshot ${id} holds no ${volume}.`);
    const source = await this.restoreSource(entry, info);
    if (source === null)
      throw new Error(
        `Snapshot ${id} has neither a native snapshot nor an archive of ${volume} any more.`,
      );
    if (source.kind === 'native') {
      logger.step(
        `Copying ${source.volume}/${source.snapshot} into a fresh ${volume}...`,
      );
      await this.copySnapshot(source, volume);
      return;
    }
    const aside = await this.client.getVolume(this.pool, holder);
    if (aside === undefined) throw new Error(`The holder ${holder} is gone.`);
    logger.step(`Extracting ${entry}.tar.gz into a fresh ${volume}...`);
    await this.client.createVolume(this.pool, {
      name: volume,
      type: 'custom',
      content_type: 'filesystem',
      config: Object.fromEntries(
        Object.entries(aside.config).filter(
          ([key]) => !key.startsWith('volatile.'),
        ),
      ),
    });
    const result = await this.options.oneShot({
      image: this.options.helperImage,
      purpose: 'restore',
      mounts: [
        { volume, target: '/data' },
        { volume: BACKUPS_VOLUME, target: '/backup', readOnly: true },
      ],
      argv: [
        'sh',
        '-c',
        `test -f /backup/${id}/${entry}.tar.gz && tar xzf /backup/${id}/${entry}.tar.gz --numeric-owner -C /data`,
      ],
      timeoutS: 4 * 3600,
    });
    if (!result.success)
      throw new Error(
        `Extracting ${entry}.tar.gz into ${volume} failed: ${result.stderr || result.stdout}`,
      );
  }

  /** Remove `volume`'s disk device from one user, under its ETag. */
  private async detach(attachment: Attachment, volume: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const read = await this.client.getInstance(attachment.instance);
      if (read === undefined) return;
      const device = read.instance.devices[attachment.device];
      if (device === undefined || device.source !== volume) return;
      try {
        await detachDevice(
          this.client,
          attachment.instance,
          attachment.device,
          {
            ifMatch: read.etag ?? '',
          },
        );
        return;
      } catch (error) {
        if (!isPreconditionFailed(error) || attempt >= 2) throw error;
      }
    }
  }

  /** Attach `volume` to one user again as it was, by its logical name. */
  private async attach(attachment: Attachment, volume: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const read = await this.client.getInstance(attachment.instance);
      if (read === undefined)
        throw new Error(
          `${attachment.instance}, a user of ${volume}, is gone.`,
        );
      const device = read.instance.devices[attachment.device];
      if (device?.type === 'disk' && device.source === volume) return;
      try {
        await attachDisk(
          this.client,
          attachment.instance,
          attachment.device,
          {
            pool: this.pool,
            source: volume,
            path: attachment.path,
            readonly: attachment.readonly,
          },
          { ifMatch: read.etag ?? '' },
        );
        return;
      } catch (error) {
        if (!isPreconditionFailed(error) || attempt >= 2) throw error;
      }
    }
  }

  /**
   * Undo the pending restore: each volume whose holder exists gets it back
   * under its own name (a fresh copy made meanwhile is deleted first), the
   * manifests name it again, and every device is attached again; then the
   * users that ran start.
   */
  async abort(): Promise<void> {
    const pending = await this.pending();
    // Users a crash left running on a fresh copy stop before it goes.
    await this.stopUsers(pending.running ?? []);
    for (const volume of [...pending.volumes].reverse()) {
      const holder = pending.holders[volume];
      const attachments = pending.attachments?.[volume] ?? [];
      if (
        holder !== undefined &&
        (await this.client.getVolume(this.pool, holder)) !== undefined
      ) {
        if ((await this.client.getVolume(this.pool, volume)) !== undefined) {
          for (const attachment of attachments)
            await this.detach(attachment, volume);
          logger.step(`Deleting the fresh ${volume}...`);
          await this.client.deleteVolume(this.pool, volume);
        }
        logger.step(`Putting ${holder} back as ${volume}...`);
        await renameVolume(this.client, this.pool, holder, volume);
      }
      if (holder !== undefined)
        await this.moveManifestReferences(holder, volume);
      for (const attachment of attachments)
        await this.attach(attachment, volume);
    }
    for (const name of pending.running ?? [])
      await startStackInstance(this.client, name);
    await clearRestorePending(this.stateRoot, this.stack);
  }
}

/** The native snapshot store of a runtime that keeps one (Incus); null for
 * Docker, whose snapshots are archives. */
export function snapshotStoreOf(
  runtime: StackRuntime,
): IncusSnapshotStore | null {
  if (runtime.snapshotKind !== 'native' || !('snapshotStore' in runtime))
    return null;
  const store: unknown =
    typeof runtime.snapshotStore === 'function'
      ? runtime.snapshotStore()
      : null;
  return store instanceof IncusSnapshotStore ? store : null;
}
