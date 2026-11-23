import pkg from '../../../package.json';
import { preconditionError } from '../../utils/fail';
import { formatBytes } from '../../utils/format-bytes';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { confirm } from '../../utils/prompt';
import {
  archiveTimeoutSeconds,
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  BLOB_VOLUME,
  CONFIG_VOLUME,
  LEGACY_BLOB_VOLUME,
  LEGACY_CONFIG_VOLUME,
  RESTORABLE_ARCHIVES,
  isValidSnapshotId,
  restoreTargetVolume,
  tarHelper,
} from '../backup/constants';
import { listSnapshots } from '../backup/list-snapshots';
import { manifestSizeBytes, type SnapshotManifest } from '../backup/manifest';
import { resolveSnapshotPrefix } from '../backup/resolve-prefix';
import { verifySnapshot } from '../backup/verify-snapshot';
import type { AppTier } from '../compose/app-tier';
import {
  RETIRED_SERVICES,
  ROTATABLE_SERVICES,
  SIDECAR_SERVICES,
  STATEFUL_SERVICES,
} from '../compose/types';
import { imageServesApp } from '../deployment/app-tier-image';
import type { getContainerState } from '../docker/get-container-state';
import type { listComposeContainers } from '../docker/list-service-containers';
import type { stopContainer } from '../docker/stop-container';
import { snapshotStoreOf } from '../runtime/incus/verbs/snapshots';
import { selectRuntime } from '../runtime/select-runtime';
import type { StackRuntime } from '../runtime/types';
import { withLock } from '../state/with-lock';
import { colorTier } from './color-lifecycle';

interface RestoreOptions {
  env: DeploymentEnv;
  /** Omitted = list available snapshots and exit. */
  snapshotId?: string;
  /** Stop live project containers instead of refusing. */
  stop?: boolean;
  /** Non-interactive: skip the confirmation prompt. */
  assumeYes?: boolean;
  /** Incus: finish the restore a crash left pending. */
  resume?: boolean;
  /** Incus: undo the restore a crash left pending. */
  abort?: boolean;
  /** The runtime to restore on; selected from `tale.json` when absent. */
  runtime?: StackRuntime;
}

/**
 * The collaborators `restore` drives, injectable so its tests can script them
 * without module-mocking the sibling modules (`list-snapshots`,
 * `verify-snapshot`) that carry their own test files — bun's `mock.module`
 * is process-wide, so a mock installed here would leak into those suites and
 * hand them a mock where they expect the real implementation.
 */
export interface RestoreDeps {
  listSnapshots: typeof listSnapshots;
  resolveSnapshotPrefix: typeof resolveSnapshotPrefix;
  verifySnapshot: typeof verifySnapshot;
  getContainerState: typeof getContainerState;
  listComposeContainers: typeof listComposeContainers;
  stopContainer: typeof stopContainer;
  /** The shape of each colour that has a `platform` to ask
   *  (compose/app-tier.ts). */
  colourTiers: () => Promise<AppTier[]>;
  /** Whether a release's platform image serves the app from its backend
   *  process; null when that image is not on this host to say. */
  releaseServesApp: (version: string) => Promise<boolean | null>;
}

/** The collaborators as the selected runtime answers them. */
function runtimeDeps(runtime: StackRuntime, env: DeploymentEnv): RestoreDeps {
  return {
    colourTiers: async () => {
      const tiers: AppTier[] = [];
      for (const colour of ['blue', 'green'] as const) {
        try {
          const tier = await colorTier(colour, runtime);
          if (tier !== null) tiers.push(tier);
        } catch (error) {
          // A colour that cannot be read says nothing here; the check that
          // asks is a courtesy before the restore, never its condition.
          logger.debug(
            `The ${colour} colour's shape could not be read: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return tiers;
    },
    releaseServesApp: async (version) => {
      const reference = `${env.GHCR_REGISTRY}/tale-platform:${version}`;
      return (await runtime.imagePresent(reference))
        ? imageServesApp(reference)
        : null;
    },
    listSnapshots: (prefix) => listSnapshots(prefix, runtime),
    resolveSnapshotPrefix: () => resolveSnapshotPrefix(runtime),
    verifySnapshot: (prefix, manifest) =>
      verifySnapshot(prefix, manifest, runtime),
    getContainerState: (name) => runtime.state(name),
    listComposeContainers: (stack, service) =>
      runtime.list(service === undefined ? { stack } : { stack, service }),
    stopContainer: (name) => runtime.stop(name),
  };
}

/**
 * The Docker states in which a container has no process and none on the way:
 * never started, stopped, or left over from a failed removal. Every other
 * state is live for a restore — `running`, but also `restarting` (an
 * `unless-stopped` replica between crash-loop attempts starts again by
 * itself), `paused` (it resumes on `docker unpause`), `removing`, and any
 * state a newer Docker adds.
 */
const STOPPED_STATES: ReadonlySet<string> = new Set([
  'created',
  'exited',
  'dead',
]);

function isLive(state: string): boolean {
  return !STOPPED_STATES.has(state);
}

interface LiveContainer {
  name: string;
  /** Docker's state word, which the refusal names. */
  state: string;
}

/**
 * Every live container of this project: the stateful tier and the dev stack
 * by their pinned names, and both colours by their compose project — a
 * colour is a replica set with compose-numbered names, so the project label
 * is the only handle that finds all of them. Both are judged by one state
 * word and one predicate, so a replica that is restarting or paused is
 * refused and stopped like the stateful tier already was.
 *
 * A model gateway an earlier release left is one of them: an older snapshot
 * writes its store back, which must not happen under a gateway that is
 * writing it.
 */
async function findLiveProjectContainers(
  deps: RestoreDeps,
): Promise<LiveContainer[]> {
  const projectId = getProjectId();
  const live: LiveContainer[] = [];
  const named: string[] = [];
  for (const service of [
    ...STATEFUL_SERVICES,
    ...SIDECAR_SERVICES,
    ...RETIRED_SERVICES,
  ]) {
    named.push(`${projectId}-${service}`);
  }
  // The dev stack pins its names; production runs the same services inside a
  // colour, found by label below.
  for (const service of ROTATABLE_SERVICES) {
    named.push(`${projectId}-${service}`);
  }
  for (const name of named) {
    // `null`: no such container, so nothing to refuse or stop.
    const state = await deps.getContainerState(name);
    if (state !== null && isLive(state)) live.push({ name, state });
  }
  for (const color of ['blue', 'green'] as const) {
    for (const container of await deps.listComposeContainers(
      `${projectId}-${color}`,
    )) {
      if (isLive(container.state)) {
        live.push({ name: container.name, state: container.state });
      }
    }
  }
  return live;
}

function totalSizeBytes(manifest: SnapshotManifest): number {
  return manifestSizeBytes(manifest);
}

/** How a listed snapshot can be restored: from native snapshots, archives,
 * or both. */
function kindOf(manifest: SnapshotManifest): string {
  const infos = Object.values(manifest.volumes);
  const native = infos.some((info) => info.native !== undefined);
  const archived = infos.every((info) => info.sha256 !== undefined);
  if (native && archived) return ' · native + archive';
  if (native) return ' · native';
  return '';
}

function hasBlobArchive(manifest: SnapshotManifest): boolean {
  return (
    BLOB_VOLUME in manifest.volumes || LEGACY_BLOB_VOLUME in manifest.volumes
  );
}

function printSnapshotList(snapshots: SnapshotManifest[]): void {
  logger.table(
    snapshots.map((snapshot) => [
      snapshot.id,
      `${snapshot.createdAt} · platform ${snapshot.platformVersion ?? 'unknown'} · ${formatBytes(totalSizeBytes(snapshot))} · ${snapshot.trigger}${kindOf(snapshot)}${hasBlobArchive(snapshot) ? '' : ' · without blobs'}`,
    ]),
  );
}

/** The running users of the volumes a native restore replaces. */
async function liveVolumeUsers(
  store: NonNullable<ReturnType<typeof snapshotStoreOf>>,
  manifest: SnapshotManifest,
): Promise<LiveContainer[]> {
  const names = new Set<string>();
  for (const archive of Object.keys(manifest.volumes))
    for (const name of await store.volumeUsers(restoreTargetVolume(archive)))
      names.add(name);
  return [...names].sort().map((name) => ({ name, state: 'running' }));
}

/**
 * A restore across releases hands the stack to the CLI of the snapshot's
 * release: its data must come back under that version (`tale update
 * --version`, then `tale deploy --stop`). A CLI from before the application
 * could run as one process deploys only over the three services: its writer
 * census looks for `backend-api` and `backend-worker`, and without them it
 * refuses with "The installed backend database connection is unknown".
 *
 * So a workspace that runs fewer services is turned back HERE, while its
 * volumes still hold their data, with the step that avoids the dead end.
 * The release says which it is through its own image, where that image is
 * still on the host; where it is not, the operator is told what to check.
 */
async function assertSnapshotReleaseCanDeploy(
  manifest: SnapshotManifest,
  deps: RestoreDeps,
): Promise<void> {
  const version = manifest.platformVersion;
  if (version === null || version === pkg.version) return;
  const runs = (await deps.colourTiers()).find(
    (tier) => tier.shape !== 'three-way',
  );
  if (runs === undefined) return;
  const servesApp = await deps.releaseServesApp(version);
  if (servesApp === true) return;
  const first =
    'set TALE_APP_TIER=three-services in .env and run `tale deploy`, then restore';
  if (servesApp === false)
    throw preconditionError(
      `Snapshot ${manifest.id} holds the data of Tale ${version}, whose CLI deploys only over the services platform, backend-api and backend-worker. This workspace runs the application as ${runs.services.join(' and ')}, which that CLI refuses once the data is restored. First ${first}. Nothing was changed.`,
    );
  logger.warn(
    `Snapshot ${manifest.id} holds the data of Tale ${version}, and that release's image is not on this host to say which services it runs. This workspace runs the application as ${runs.services.join(' and ')}. If Tale ${version} is from before the application could run as one process, its CLI refuses this workspace once the data is restored: stop here, ${first}.`,
  );
}

export async function restore(
  options: RestoreOptions,
  injected?: RestoreDeps,
): Promise<void> {
  const { env, snapshotId } = options;
  const runtime = options.runtime ?? (await selectRuntime(env.DEPLOY_DIR));
  const deps = injected ?? runtimeDeps(runtime, env);

  if (options.resume === true || options.abort === true) {
    if (options.resume === true && options.abort === true)
      throw new Error(
        'Choose one: --resume finishes the restore, --abort undoes it.',
      );
    if (snapshotId !== undefined)
      throw new Error(
        `--${options.resume === true ? 'resume' : 'abort'} acts on the pending restore and takes no snapshot id.`,
      );
    if (runtime.snapshotKind !== 'native')
      throw new Error(
        'Docker restores in place and never leaves a restore pending: there is nothing to resume or abort.',
      );
    const kind = options.resume === true ? 'resume' : 'abort';
    await withLock(env.DEPLOY_DIR, `restore --${kind}`, async () => {
      logger.header(
        kind === 'resume' ? 'Finishing the Restore' : 'Undoing the Restore',
      );
      await runtime.restoreSnapshot({ kind });
      logger.success(
        kind === 'resume'
          ? 'The restore is finished.'
          : 'The restore is undone: every volume is back as it was.',
      );
    });
    return;
  }

  const prefix = await deps.resolveSnapshotPrefix();
  if (prefix === null) {
    throw new Error(
      'No Tale data volumes found for this project — nothing to restore into. ' +
        'On a fresh host, run `tale deploy` once (or `tale dev` for a dev stack) ' +
        'to create the volume set, then restore.',
    );
  }

  const snapshots = await deps.listSnapshots(prefix);

  if (!snapshotId) {
    logger.header('Available Snapshots');
    if (snapshots.length === 0) {
      logger.info(`No snapshots found in ${prefix}${BACKUP_VOLUME}.`);
      logger.info('Create one with: tale backup');
      return;
    }
    printSnapshotList(snapshots);
    logger.blank();
    logger.info(
      'Restore with: tale restore <snapshot-id> (the stack must be stopped; add --stop to stop it)',
    );
    return;
  }

  if (!isValidSnapshotId(snapshotId)) {
    throw new Error(
      `Invalid snapshot id "${snapshotId}" — run \`tale restore\` to list available snapshots.`,
    );
  }
  const manifest = snapshots.find((snapshot) => snapshot.id === snapshotId);
  if (!manifest) {
    throw new Error(
      `Snapshot ${snapshotId} not found in ${prefix}${BACKUP_VOLUME} — run \`tale restore\` to list available snapshots.`,
    );
  }

  await withLock(env.DEPLOY_DIR, `restore ${snapshotId}`, async () => {
    logger.header(`Restoring Snapshot ${snapshotId}`);

    // Restoring under a live stack guarantees corruption — Postgres would
    // be rewritten underneath a running postmaster. Refuse unless stopped.
    // On Incus the restore stops the volumes' users itself, gracefully,
    // and starts them again: `--stop` is the consent to that.
    const store = snapshotStoreOf(runtime);
    // On Incus the application runs as three services in every release.
    if (store === null) await assertSnapshotReleaseCanDeploy(manifest, deps);
    const live =
      store === null
        ? await findLiveProjectContainers(deps)
        : await liveVolumeUsers(store, manifest);
    if (live.length > 0) {
      if (!options.stop) {
        throw new Error(
          `Refusing to restore while project containers are live: ${live.map(({ name, state }) => `${name} (${state})`).join(', ')}.\n` +
            '  Stop them first, or re-run with --stop.',
        );
      }
      // A stop also ends a restart loop and stops a paused container (Docker:
      // `unless-stopped` then keeps either down, even across a daemon restart).
      if (store !== null) {
        logger.info('The restore stops them gracefully and starts them again.');
      }
      if (store === null) logger.step('Stopping live project containers...');
      for (const { name } of store === null ? live : []) {
        const stopped = await deps.stopContainer(name);
        if (!stopped) {
          throw new Error(`Failed to stop ${name} — aborting restore.`);
        }
      }
    }

    // Restore only archive names the CLI itself writes — a tampered manifest
    // must not be able to address arbitrary volumes. Each is paired with the
    // LIVE volume it belongs in: a snapshot from before the config-volume
    // rename filed the config tree as `convex-data.tar.gz`, and it restores
    // into today's `config-data`.
    const archives = Object.keys(manifest.volumes)
      .filter((archive) =>
        (RESTORABLE_ARCHIVES as readonly string[]).includes(archive),
      )
      .map((archive) => ({ archive, volume: restoreTargetVolume(archive) }))
      // A manifest carrying BOTH config archive names would restore one over
      // the other; keep the current name and say the older one is ignored.
      .filter((entry, _index, all) => {
        if (entry.archive !== LEGACY_CONFIG_VOLUME) return true;
        const superseded = all.some((other) => other.archive === CONFIG_VOLUME);
        if (superseded) {
          logger.warn(
            `Snapshot ${snapshotId} carries both ${LEGACY_CONFIG_VOLUME} and ${CONFIG_VOLUME} archives — restoring ${CONFIG_VOLUME} and ignoring the older one.`,
          );
        }
        return !superseded;
      });
    if (archives.length === 0) {
      throw new Error(`Snapshot ${snapshotId} contains no restorable volumes`);
    }
    const volumes = archives.map((entry) => entry.volume);
    // Snapshots from before blobs were captured — and snapshots of a
    // deployment whose blobs live in external S3 — carry no blob archive.
    // Restore what the snapshot has; say what it does not touch.
    if (
      !volumes.includes(BLOB_VOLUME) &&
      !volumes.includes(LEGACY_BLOB_VOLUME)
    ) {
      logger.notice(
        `Snapshot ${snapshotId} has no ${BLOB_VOLUME} archive (taken before blobs were captured, or with an external blob store) — the blob volume is left untouched.`,
      );
    }
    // A snapshot from MinIO's time holds the blobs in MinIO's format, under
    // the volume name of that time. Restored, they are the deployment's
    // blobs again. What a later store wrote into `blob-data` belongs to the
    // state this restore replaces: left there, the next deploy would find
    // it, take that volume for the live one, and serve its blobs beside a
    // database that knows other ones. So it is emptied with the rest, and
    // the next deploy finds the blobs in MinIO's volume.
    const emptiedBlobStore =
      store === null &&
      volumes.includes(LEGACY_BLOB_VOLUME) &&
      !volumes.includes(BLOB_VOLUME) &&
      (await runtime.volumeExists(`${prefix}${BLOB_VOLUME}`));
    // The config store has no such excuse: every snapshot the CLI has ever
    // written captured it, so a manifest without one is a torn snapshot and
    // restoring it would leave the deployment with no organization config.
    if (!volumes.includes(CONFIG_VOLUME)) {
      logger.warn(
        `Snapshot ${snapshotId} has no ${CONFIG_VOLUME} (or ${LEGACY_CONFIG_VOLUME}) archive — the org config store is left untouched. This snapshot is incomplete.`,
      );
    }

    if (!resolveConsent(options.assumeYes)) {
      if (store !== null)
        logger.warn(
          `This sets aside ${volumes.join(', ')} as <volume>.pre-restore-<time> (kept, with their snapshots, until \`tale backup prune\` finds no listed snapshot on them)`,
        );
      else
        logger.warn(
          `This wipes the current contents of: ${[...volumes, ...(emptiedBlobStore ? [BLOB_VOLUME] : [])].map((volume) => `${prefix}${volume}`).join(', ')}`,
        );
      logger.warn(
        `and replaces them with snapshot ${snapshotId} (created ${manifest.createdAt}, platform ${manifest.platformVersion ?? 'unknown'}).`,
      );
      const ok = await confirm({ message: 'Restore now?', default: false });
      if (!ok) {
        throw new Error('Restore aborted');
      }
    }

    logger.step('Verifying snapshot integrity...');
    await deps.verifySnapshot(prefix, manifest);

    if (store !== null) {
      // Fresh volumes, never in place, journaled until every volume is back
      // (design D-29, R3-22).
      await runtime.restoreSnapshot({
        kind: 'start',
        id: snapshotId,
        volumes: archives.map((entry) => entry.archive),
      });
      logger.success(`Snapshot ${snapshotId} restored; its users run again.`);
      if (manifest.platformVersion !== null)
        logger.info(
          `The data is from platform ${manifest.platformVersion}: deploy that version if the stack runs another.`,
        );
      return;
    }

    // Fresh-host case: re-create any missing target volumes first.
    const volumesReady = await runtime.ensureVolumes(volumes, prefix);
    if (!volumesReady) {
      throw new Error('Failed to create target volumes');
    }

    for (const { archive, volume } of archives) {
      logger.step(
        `Restoring ${prefix}${volume}${archive === volume ? '' : ` (from ${archive}.tar.gz)`}...`,
      );
      // The blob store's files get their extended attributes back from a
      // tar that knows of them, as they were archived.
      const tar = tarHelper(volume);
      const result = await runtime.oneShot({
        image: tar.image,
        mounts: [
          { volume: `${prefix}${volume}`, target: '/data' },
          {
            volume: `${prefix}${BACKUP_VOLUME}`,
            target: '/backup',
            readOnly: true,
          },
        ],
        argv: [
          'sh',
          '-c',
          // Never wipe the live volume for an archive that is not there:
          // the existence check runs BEFORE the delete, inside the same
          // helper container that will extract.
          `test -f /backup/${snapshotId}/${archive}.tar.gz && find /data -mindepth 1 -delete && tar xzf /backup/${snapshotId}/${archive}.tar.gz${tar.flags} -C /data`,
        ],
        timeoutS: archiveTimeoutSeconds(volume),
      });
      if (!result.success) {
        throw new Error(
          `Restore of ${prefix}${volume} failed: ${result.stderr || result.stdout}\n` +
            '  The volume may be partially restored — re-run the restore before starting the stack.',
        );
      }
    }
    if (emptiedBlobStore) {
      logger.step(
        `Emptying ${prefix}${BLOB_VOLUME} (the snapshot's blobs are in ${prefix}${LEGACY_BLOB_VOLUME})...`,
      );
      const emptied = await runtime.oneShot({
        image: BACKUP_HELPER_IMAGE,
        mounts: [{ volume: `${prefix}${BLOB_VOLUME}`, target: '/data' }],
        argv: ['sh', '-c', 'find /data -mindepth 1 -delete'],
        timeoutS: archiveTimeoutSeconds(BLOB_VOLUME),
      });
      if (!emptied.success) {
        throw new Error(
          `Emptying ${prefix}${BLOB_VOLUME} failed: ${emptied.stderr || emptied.stdout}\n` +
            `  The snapshot's blobs are restored in ${prefix}${LEGACY_BLOB_VOLUME}, and the next deploy would pass them over for what is left in ${prefix}${BLOB_VOLUME} — re-run the restore before starting the stack.`,
        );
      }
    }

    logger.success(`Snapshot ${snapshotId} restored.`);
    logger.blank();
    logger.info('Bring the stack back on the version that matches the data:');
    if (prefix.endsWith('-dev_')) {
      logger.info('  tale dev');
    } else {
      logger.info(
        `  tale update --version ${manifest.platformVersion ?? '<version-at-snapshot-time>'}`,
      );
      logger.info('  tale deploy --stop');
    }
  });
}
