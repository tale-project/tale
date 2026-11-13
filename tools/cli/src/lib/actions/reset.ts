import { unlink } from 'node:fs/promises';

import { preconditionError } from '../../utils/fail';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { confirm } from '../../utils/prompt';
import { BACKUP_VOLUME } from '../backup/constants';
import { archiveNativeSnapshot } from '../backup/create-snapshot';
import { listSnapshots } from '../backup/list-snapshots';
import { verifySnapshot } from '../backup/verify-snapshot';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import type { DeploymentColor } from '../compose/types';
import { SIDECAR_SERVICES, STATEFUL_SERVICES } from '../compose/types';
import {
  snapshotStoreOf,
  type IncusSnapshotStore,
} from '../runtime/incus/verbs/snapshots';
import { selectRuntime } from '../runtime/select-runtime';
import type { StackRuntime } from '../runtime/types';
import { getPreviousVersionFilePath } from '../state/get-previous-version-file-path';
import { getStateFilePath } from '../state/get-state-file-path';
import { withLock } from '../state/with-lock';
import { removeColorContainers } from './color-lifecycle';
import { retireLegacyBackendTier } from './retire-legacy-backend';

interface ResetOptions {
  env: DeploymentEnv;
  force: boolean;
  includeStateful: boolean;
  dryRun: boolean;
  /** The runtime to reset; selected from `tale.json` when absent. */
  runtime?: StackRuntime;
  /** Incus: delete the data volumes even when the newest snapshot set
   * could not be archived into `backups` first, losing its native
   * snapshots (R-05). */
  discardSnapshots?: boolean;
}

/**
 * The volumes `--all` deletes: each volume a deploy creates under the
 * project's `<id>_` prefix, by name. Never `backups`, which the first snapshot
 * creates and which holds the snapshots `tale restore` lists, the one way back
 * from this reset; never the dev stack's `<id>-dev_` volumes either.
 */
function dataVolumes(): string[] {
  return REQUIRED_VOLUMES.filter((name: string) => name !== BACKUP_VOLUME).map(
    (name) => `${getProjectId()}_${name}`,
  );
}

/**
 * Incus (design D-28a, R-05): a native snapshot lives on its volume, so
 * deleting the data volumes deletes every native recovery point. Before
 * they go, the newest snapshot set gets a tar.gz archive of each volume in
 * `backups` (verified by sha256), which survives; when that fails the reset
 * is refused, unless `--discard-snapshots` accepts the loss.
 */
async function keepNewestSnapshot(
  runtime: StackRuntime,
  discard: boolean,
): Promise<void> {
  const fail = (detail: string) => {
    if (discard) {
      logger.warn(
        `${detail} --discard-snapshots: the native snapshots go with the data volumes.`,
      );
      return;
    }
    throw preconditionError(
      `${detail} The reset would delete every native snapshot with the data volumes, so nothing was deleted.`,
      [
        'tale backup --archive         (archive a fresh snapshot, then reset again)',
        'tale reset --all --discard-snapshots   (delete them anyway)',
      ],
    );
  };
  let newest;
  try {
    newest = (await listSnapshots('', runtime))[0];
  } catch (error) {
    fail(
      `The snapshots in ${BACKUP_VOLUME} could not be listed: ${errorText(error)}.`,
    );
    return;
  }
  if (newest === undefined) {
    logger.warn(`There is no snapshot in ${BACKUP_VOLUME} to keep.`);
    return;
  }
  logger.step(
    `Archiving snapshot ${newest.id} into ${BACKUP_VOLUME}, so it outlives the volumes...`,
  );
  try {
    const archived = await archiveNativeSnapshot(runtime, newest);
    await verifySnapshot('', archived, runtime);
    logger.info(
      `Snapshot ${newest.id} is archived in ${BACKUP_VOLUME} and verified.`,
    );
  } catch (error) {
    fail(
      `Snapshot ${newest.id} could not be archived into ${BACKUP_VOLUME}: ${errorText(error)}.`,
    );
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What `--all` deletes and keeps on Incus, before the question. */
async function warnIncusVolumes(store: IncusSnapshotStore): Promise<void> {
  logger.warn(
    `and deleting their data volumes, which cannot be undone: ${(await store.dataVolumes()).join(', ')}. ` +
      `Their native snapshots go with them; the newest snapshot is archived into ${BACKUP_VOLUME} first, which is kept with the archives and manifests it holds. Volumes set aside by a restore are kept.`,
  );
}

export async function reset(options: ResetOptions): Promise<void> {
  const { env, force, includeStateful, dryRun } = options;
  const runtime = options.runtime ?? (await selectRuntime(env.DEPLOY_DIR));
  const store = snapshotStoreOf(runtime);

  logger.warn('This will remove ALL blue-green containers');
  if (includeStateful) {
    logger.warn(
      `Including stateful services: ${[...STATEFUL_SERVICES, ...SIDECAR_SERVICES].join(', ')}`,
    );
    if (store !== null) await warnIncusVolumes(store);
    else
      logger.warn(
        `and deleting their data volumes, which cannot be undone: ${dataVolumes().join(', ')}. ` +
          `The snapshots in ${getProjectId()}_${BACKUP_VOLUME} are kept.`,
      );
  }

  // `--force` or the global `tale -y` consents; the confirm below would
  // otherwise resolve to its `default` (false) under --yes and cancel.
  if (!resolveConsent(force)) {
    const confirmed = await confirm({
      message: 'Are you sure you want to reset?',
      default: false,
    });
    if (!confirmed) {
      logger.info('Reset cancelled');
      return;
    }
  }

  await withLock(env.DEPLOY_DIR, 'reset', async () => {
    const prefix = dryRun ? '[DRY-RUN] ' : '';
    logger.header(`${prefix}Resetting Deployment`);

    // Before anything is removed: the newest snapshot set must outlive the
    // data volumes on Incus, or the reset stops here (R-05).
    if (includeStateful && store !== null && !dryRun)
      await keepNewestSnapshot(runtime, options.discardSnapshots === true);

    // Remove all blue-green containers. Listed by compose project, not by
    // reconstructed name: a colour is a replica set, so what has to go is
    // every container compose created for it.
    for (const color of ['blue', 'green'] as DeploymentColor[]) {
      logger.step(`${prefix}Removing ${color} containers...`);
      const project = `${getProjectId()}-${color}`;
      if (dryRun) {
        for (const container of await runtime.list({ stack: project })) {
          logger.info(`${prefix}Would remove: ${container.name}`);
        }
      } else {
        await removeColorContainers(project, runtime);
      }
    }

    // Pre-upgrade leftovers: the backend tier used to be a stateful singleton
    // outside both colours, so neither sweep above sees it.
    if (dryRun) {
      for (const service of ['backend-api', 'backend-worker'] as const) {
        for (const container of await runtime.list({
          stack: getProjectId(),
          service,
        })) {
          logger.info(`${prefix}Would remove: ${container.name}`);
        }
      }
    } else {
      await retireLegacyBackendTier(runtime);
    }

    // Optionally remove stateful containers
    if (includeStateful) {
      logger.step(`${prefix}Removing stateful containers...`);
      // The sidecars restart unless stopped: left behind, they keep running
      // after the CLI is gone and pin the project network against the prune.
      for (const service of [...STATEFUL_SERVICES, ...SIDECAR_SERVICES]) {
        const containerName = `${getProjectId()}-${service}`;
        if (dryRun) {
          logger.info(`${prefix}Would remove: ${containerName}`);
        } else {
          await runtime.remove(containerName);
        }
      }
    }

    // Clean up state files
    logger.step(`${prefix}Cleaning up state files...`);
    const stateFiles = [
      getStateFilePath(env.DEPLOY_DIR),
      getPreviousVersionFilePath(env.DEPLOY_DIR),
    ];

    for (const file of stateFiles) {
      if (dryRun) {
        logger.info(`${prefix}Would remove: ${file}`);
      } else {
        try {
          await unlink(file);
          logger.info(`Removed ${file}`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.warn(`Failed to remove ${file}: ${err}`);
          }
        }
      }
    }

    // Prune unused networks for this project only
    logger.step(`${prefix}Pruning unused Docker networks...`);
    if (!dryRun) {
      const pruned = await runtime.pruneNetworks();
      if (!pruned.success) {
        logger.warn(
          `Failed to prune project networks: ${pruned.stderr.trim() || 'no stderr captured'}`,
        );
      }
    } else {
      logger.info(
        `${prefix}Would prune unused Docker networks for project ${getProjectId()}`,
      );
    }

    // Only delete volumes when the user explicitly asked to include stateful
    // services — volume data is not recoverable. `includeStateful` is the
    // `--all` flag, which is the same consent boundary used for removing
    // db/proxy containers above. By name, not by `docker volume prune`: since
    // API 1.42 (Engine 23.0) a prune removes only anonymous volumes unless
    // given `--all`, which older daemons refuse, and every volume here is
    // named. The `project` label a prune would filter on also marks the
    // snapshots and the dev stack's volumes.
    if (includeStateful && store !== null) {
      if (dryRun) {
        for (const volume of await store.dataVolumes())
          logger.info(`${prefix}Would remove volume: ${volume}`);
        logger.info(
          `${prefix}Would archive the newest snapshot into ${BACKUP_VOLUME} first, and keep ${BACKUP_VOLUME}`,
        );
      } else {
        logger.step('Removing data volumes...');
        for (const volume of await store.dataVolumes())
          await runtime.removeVolume(volume);
        // The next deploy may make the data volumes again (R3-22).
        await store.recordReset();
        logger.info(
          `Kept volume: ${BACKUP_VOLUME}, with the snapshots \`tale restore\` lists. To delete them as well: ${await runtime.volumeRemovalHint(BACKUP_VOLUME)}`,
        );
      }
    } else if (includeStateful) {
      logger.step(`${prefix}Removing data volumes...`);
      for (const volume of dataVolumes()) {
        if (dryRun) {
          logger.info(`${prefix}Would remove volume: ${volume}`);
        } else {
          await runtime.removeVolume(volume);
        }
      }
      // The runtime names how to delete the volume by hand, when it is
      // there. Docker reads it with the `docker` runner itself, not
      // `volumeExists`: other suites replace `ensure-volumes` with Bun's
      // process-global `mock.module`, and reset's tests would then read their
      // stub instead of their own docker mock.
      const backups = `${getProjectId()}_${BACKUP_VOLUME}`;
      const removal = await runtime.volumeRemovalHint(backups);
      if (removal !== null) {
        logger.info(
          `${prefix}${dryRun ? 'Would keep' : 'Kept'} volume: ${backups}, with the snapshots \`tale restore\` lists. ` +
            `To delete them as well: ${removal}`,
        );
      }
    }

    if (dryRun) {
      logger.success(
        `${prefix}Dry-run complete! Would remove all blue-green containers`,
      );
    } else {
      logger.success('Reset complete! All blue-green containers removed');
    }
    if (!includeStateful) {
      logger.info(
        `Stateful services (${STATEFUL_SERVICES.join(', ')}) were preserved`,
      );
      logger.info(
        'Use --all to remove them as well, together with their data volumes',
      );
    }
  });
}
