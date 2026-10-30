import { unlink } from 'node:fs/promises';

import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { confirm } from '../../utils/prompt';
import { BACKUP_VOLUME } from '../backup/constants';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import type { DeploymentColor } from '../compose/types';
import { SIDECAR_SERVICES, STATEFUL_SERVICES } from '../compose/types';
import { docker } from '../docker/docker';
import { volumeExists } from '../docker/ensure-volumes';
import { listComposeContainers } from '../docker/list-service-containers';
import { removeContainer } from '../docker/remove-container';
import { removeVolume } from '../docker/remove-volume';
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

export async function reset(options: ResetOptions): Promise<void> {
  const { env, force, includeStateful, dryRun } = options;

  logger.warn('This will remove ALL blue-green containers');
  if (includeStateful) {
    logger.warn(
      `Including stateful services: ${[...STATEFUL_SERVICES, ...SIDECAR_SERVICES].join(', ')}`,
    );
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

    // Remove all blue-green containers. Listed by compose project, not by
    // reconstructed name: a colour is a replica set, so what has to go is
    // every container compose created for it.
    for (const color of ['blue', 'green'] as DeploymentColor[]) {
      logger.step(`${prefix}Removing ${color} containers...`);
      const project = `${getProjectId()}-${color}`;
      if (dryRun) {
        for (const container of await listComposeContainers(project)) {
          logger.info(`${prefix}Would remove: ${container.name}`);
        }
      } else {
        await removeColorContainers(project);
      }
    }

    // Pre-upgrade leftovers: the backend tier used to be a stateful singleton
    // outside both colours, so neither sweep above sees it.
    if (dryRun) {
      for (const service of ['backend-api', 'backend-worker'] as const) {
        for (const container of await listComposeContainers(
          getProjectId(),
          service,
        )) {
          logger.info(`${prefix}Would remove: ${container.name}`);
        }
      }
    } else {
      await retireLegacyBackendTier();
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
          await removeContainer(containerName);
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
      const pruned = await docker(
        'network',
        'prune',
        '-f',
        '--filter',
        `label=project=${getProjectId()}`,
      );
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
    if (includeStateful) {
      logger.step(`${prefix}Removing data volumes...`);
      for (const volume of dataVolumes()) {
        if (dryRun) {
          logger.info(`${prefix}Would remove volume: ${volume}`);
        } else {
          await removeVolume(volume);
        }
      }
      const backups = `${getProjectId()}_${BACKUP_VOLUME}`;
      if (await volumeExists(backups)) {
        logger.info(
          `${prefix}${dryRun ? 'Would keep' : 'Kept'} volume: ${backups}, with the snapshots \`tale restore\` lists. ` +
            `To delete them as well: docker volume rm ${backups}`,
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
