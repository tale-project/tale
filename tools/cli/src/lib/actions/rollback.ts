import { sameMinor } from '../../utils/compare-versions';
import { externalDepError } from '../../utils/fail';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { runStepsInParallel } from '../../utils/progress';
import { confirm } from '../../utils/prompt';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { ROTATABLE_SERVICES } from '../compose/types';
import { dockerCompose } from '../docker/docker-compose';
import { ensureNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
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
  /**
   * Skip the confirmation prompt (the command's `-y/--yes` flag). The global
   * `tale -y <cmd>` flag counts as consent too — see `resolveConsent`.
   */
  assumeYes?: boolean;
}

/**
 * `pullImage` is injectable so the unit test can supply a fake without
 * `mock.module`-ing the shared pull-image module. That mock is process-global
 * in Bun and is not reset between files; it leaked into pull-image.test.ts and
 * broke its suite on Windows (where Bun's per-file mock scoping doesn't hold).
 * The rollback's other collaborators are still swapped via mock.module in the
 * test — none of them has a sibling suite that imports the real module.
 */
interface RollbackDeps {
  pullImage?: typeof pullImage;
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
  logger.info(
    'Minor and major upgrades can run forward-only data migrations, so an',
  );
  logger.info('older binary must never run on top of migrated data. To roll');
  logger.info('back across versions, restore the pre-upgrade snapshot:');
  logger.info(
    '  1. Stop the stack and list the snapshots taken before deploys:',
  );
  logger.info('       tale restore');
  logger.info('  2. Restore the one taken before the upgrade:');
  logger.info('       tale restore <snapshot-id> --stop');
  logger.info(
    '  3. Move the CLI to the version that matches the restored data,',
  );
  logger.info('     then roll the containers to match:');
  logger.info('       tale update --version <version>');
  logger.info('       tale deploy --stop');
  logger.info('  (see docs/en/self-hosted/operate/backups-and-restore.md).');
}

export async function rollback(
  options: RollbackOptions,
  deps: RollbackDeps = {},
): Promise<void> {
  const { env } = options;
  const assumeYes = resolveConsent(options.assumeYes);
  const pull = deps.pullImage ?? pullImage;

  await withLock(env.DEPLOY_DIR, 'rollback', async () => {
    logger.header('Rolling Back Deployment');

    // Get current state
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    if (!currentColor) {
      logger.error('No active deployment to rollback from');
      throw new Error('No active deployment');
    }

    // Image-rollback gate: this command only swaps the running binary, so the
    // only safe automatic target is a patch-level step from the running version
    // (the "patch = always safe" contract in
    // docs/en/self-hosted/operate/upgrades.md). Crossing a minor/major may have
    // run forward-only data migrations, so here we refuse and point at the
    // snapshot-restore runbook rather than rolling the image onto a
    // forward-migrated schema.
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

    // Destructive, hard-to-undo: this redeploys the previous patch on the idle
    // colour, flips traffic, then drains and tears down the running containers.
    // Warn what's about to happen and require explicit consent before pulling a
    // single image. `--yes` (assumeYes) skips the prompt for non-interactive use;
    // we gate on it rather than letting `confirm` resolve, because `confirm`
    // returns its `default` (false here) under --yes, which would cancel.
    logger.warn(
      `About to roll the live platform back from ${currentVersion} to ${rollbackVersion}.`,
    );
    logger.warn(
      'This redeploys the previous patch on the idle colour, flips traffic, and ' +
        'tears down the current containers. It rolls back the binary only — ' +
        'data is not migrated down.',
    );
    if (!assumeYes) {
      const ok = await confirm({ message: 'Roll back now?', default: false });
      if (!ok) {
        logger.info('Rollback cancelled');
        return;
      }
    }

    const serviceConfig = {
      version: rollbackVersion,
      registry: env.GHCR_REGISTRY,
    };

    // Pull previous-version images CONCURRENTLY, reporting each as a step so
    // progress + failure attribution stay clear. A single failure doesn't
    // cancel the others; collect them and report together.
    const pullResults = await runStepsInParallel(
      ROTATABLE_SERVICES.map((service) => {
        const image = `${env.GHCR_REGISTRY}/tale-${service}:${rollbackVersion}`;
        return {
          label: image,
          run: async () => {
            if (!(await pull(image))) throw new Error(`pull failed: ${image}`);
          },
        };
      }),
      { title: 'Pulling previous version images' },
    );
    const failedPulls = pullResults.filter((r) => !r.ok).map((r) => r.label);
    if (failedPulls.length > 0) {
      // The registry is an external dependency: exit 5, as documented.
      throw externalDepError(
        `Failed to pull ${failedPulls.length} image(s): ${failedPulls.join(', ')}`,
      );
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

    // Pre-mark the old platform colour as shutting down BEFORE the drain sleep
    // so its /api/health 503s and the proxy stops routing new requests to it
    // while in-flight ones finish (mirrors deploy.ts). Best-effort + platform-
    // specific; a failure just falls back to the graceful stop below.
    for (const service of ROTATABLE_SERVICES) {
      if (service !== 'platform') continue;
      const oldName = `${getProjectId()}-${service}-${currentColor}`;
      const marked = await exec('docker', [
        'exec',
        oldName,
        'touch',
        '/tmp/platform-shutting-down',
      ]);
      if (!marked.success) {
        logger.debug(
          `Could not pre-mark ${oldName} for shutdown (continuing): ${marked.stderr.trim()}`,
        );
      }
    }

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
