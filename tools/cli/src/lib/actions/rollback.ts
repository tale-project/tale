import { sameMinor } from '../../utils/compare-versions';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { ROTATABLE_SERVICES } from '../compose/types';
import { dockerCompose } from '../docker/docker-compose';
import { ensureNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { getContainerVersion } from '../docker/get-container-version';
import { pullImage } from '../docker/pull-image';
import { removeContainer } from '../docker/remove-container';
import { stopContainer } from '../docker/stop-container';
import { waitForHealthy } from '../docker/wait-for-healthy';
import { getCurrentColor } from '../state/get-current-color';
import { getOppositeColor } from '../state/get-opposite-color';
import { getPreviousVersion } from '../state/get-previous-version';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';

interface RollbackOptions {
  env: DeploymentEnv;
}

/**
 * Printed whenever the rollback gate refuses. Minor and major upgrades can
 * run forward-only data migrations, so re-deploying an older binary on top
 * of migrated data corrupts the instance instead of recovering it — the
 * real recovery path is restoring the pre-upgrade backup and re-deploying
 * the version that matches it.
 */
function printSnapshotRestoreRunbook(): void {
  logger.blank();
  logger.info('Minor and major upgrades can run forward-only data migrations;');
  logger.info(
    'redeploying an older binary on top of migrated data corrupts the',
  );
  logger.info('instance instead of recovering it. To recover:');
  logger.info('  1. Restore the data-volume backup taken before the upgrade');
  logger.info('     (see docs/self-hosted/operate/backups-and-restore.md).');
  logger.info('  2. Re-deploy the version that matches the restored data:');
  logger.info('       tale upgrade --version <version>');
  logger.info('       tale deploy --all');
}

export async function rollback(options: RollbackOptions): Promise<void> {
  const { env } = options;

  await withLock(env.DEPLOY_DIR, 'rollback', async () => {
    logger.header('Rolling Back Deployment');

    // Get current state
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    if (!currentColor) {
      logger.error('No active deployment to rollback from');
      throw new Error('No active deployment');
    }

    // Forward-only migration gate: the only legal rollback target is the
    // recorded previous version, and only when it is a patch-level step
    // from the running version (the "patch = always safe" contract in
    // docs/self-hosted/operate/upgrades.md). There is no applied-migrations
    // ledger to consult, so anything beyond a patch difference must be
    // treated as potentially migrated — refuse and point at the
    // snapshot-restore runbook instead of corrupting the instance.
    const rollbackVersion = await getPreviousVersion(env.DEPLOY_DIR);
    if (!rollbackVersion) {
      logger.error('No previous version recorded — nothing to roll back to.');
      printSnapshotRestoreRunbook();
      throw new Error('No previous version');
    }

    const currentVersion = await getContainerVersion(
      `${getProjectId()}-platform-${currentColor}`,
    );
    if (!currentVersion) {
      logger.error(
        'Cannot determine the running platform version — refusing to roll back blind.',
      );
      printSnapshotRestoreRunbook();
      throw new Error('Unknown running version');
    }

    let isPatchRollback: boolean;
    try {
      isPatchRollback = sameMinor(currentVersion, rollbackVersion);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      printSnapshotRestoreRunbook();
      throw new Error('Rollback refused: cannot compare versions', {
        cause: err,
      });
    }
    if (!isPatchRollback) {
      logger.error(
        `Refusing to roll back from ${currentVersion} to ${rollbackVersion}: ` +
          'only patch-level rollbacks (same major.minor) are safe.',
      );
      printSnapshotRestoreRunbook();
      throw new Error('Rollback refused: not a patch-level rollback');
    }

    const rollbackColor = getOppositeColor(currentColor);

    logger.info(`Current color: ${currentColor}`);
    logger.info(`Current version: ${currentVersion}`);
    logger.info(
      `Rolling back to: ${rollbackColor} (version ${rollbackVersion})`,
    );

    const serviceConfig = {
      version: rollbackVersion,
      registry: env.GHCR_REGISTRY,
    };

    // Pull previous version images sequentially for clearer progress and failure attribution
    logger.step('Pulling previous version images...');
    for (const service of ROTATABLE_SERVICES) {
      const image = `${env.GHCR_REGISTRY}/tale-${service}:${rollbackVersion}`;
      const success = await pullImage(image);
      if (!success) {
        throw new Error(`Failed to pull image: ${image}`);
      }
    }

    // Clean up any stale containers from a previous failed rollback on this
    // color. Without this, `docker compose up -d` will silently restart the
    // existing container (possibly with different/old config) and report
    // success. Deploy does the same cleanup; mirror it here.
    logger.step(`Cleaning up any stale ${rollbackColor} containers...`);
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${getProjectId()}-${service}-${rollbackColor}`;
      await stopContainer(containerName);
      await removeContainer(containerName);
    }

    // Ensure infrastructure exists before compose up
    await ensureVolumes([...REQUIRED_VOLUMES]);
    await ensureNetwork('internal');

    // Deploy rollback color
    logger.step(
      `Deploying ${rollbackColor} services with version ${rollbackVersion}...`,
    );
    const colorCompose = generateColorCompose(serviceConfig, rollbackColor);

    const deployResult = await dockerCompose(colorCompose, ['up', '-d'], {
      projectName: `${getProjectId()}-${rollbackColor}`,
      cwd: env.DEPLOY_DIR,
    });

    if (!deployResult.success) {
      logger.error(`Failed to deploy ${rollbackColor} services`);
      logger.error(deployResult.stderr);
      throw new Error('Rollback deployment failed');
    }

    // Wait for services to be healthy
    logger.step('Waiting for services to be healthy...');
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${getProjectId()}-${service}-${rollbackColor}`;
      const healthy = await waitForHealthy(containerName, {
        timeout: env.HEALTH_CHECK_TIMEOUT,
      });
      if (!healthy) {
        throw new Error(
          `Service ${service}-${rollbackColor} failed health check`,
        );
      }
    }

    // Switch traffic and update version history
    logger.step(`Switching traffic to ${rollbackColor}...`);
    await setCurrentColor(env.DEPLOY_DIR, rollbackColor);
    await setPreviousVersion(env.DEPLOY_DIR, currentVersion);
    logger.info(`Version history updated: previous=${currentVersion}`);

    // Drain current color
    logger.step(`Draining ${currentColor} services (${env.DRAIN_TIMEOUT}s)...`);
    await Bun.sleep(env.DRAIN_TIMEOUT * 1000);

    // Stop and remove current color containers
    logger.step(`Stopping ${currentColor} services...`);
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${getProjectId()}-${service}-${currentColor}`;
      const stopped = await stopContainer(containerName);
      if (!stopped) {
        logger.warn(`Failed to stop ${containerName}`);
      }
      const removed = await removeContainer(containerName);
      if (!removed) {
        logger.warn(`Failed to remove ${containerName}`);
      }
    }

    logger.success(
      `Rollback complete! Version ${rollbackVersion} is now live on ${rollbackColor}`,
    );
  });
}
