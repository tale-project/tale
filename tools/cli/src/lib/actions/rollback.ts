import { sameMinor } from '../../utils/compare-versions';
import { externalDepError } from '../../utils/fail';
import {
  getProjectId,
  getReplicaCounts,
  type DeploymentEnv,
} from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { runStepsInParallel } from '../../utils/progress';
import { confirm } from '../../utils/prompt';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { ROTATABLE_SERVICES, imageRef } from '../compose/types';
import { ensureNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { migrateConfigVolume } from '../docker/migrate-config-volume';
import { pullImage } from '../docker/pull-image';
import {
  clearFlipPending,
  getFlipPending,
  setFlipPending,
} from '../state/flip-pending';
import { getCurrentColor } from '../state/get-current-color';
import { getOppositeColor } from '../state/get-opposite-color';
import { getPreviousVersion } from '../state/get-previous-version';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';
import {
  colorLooksUp,
  colorPlatformVersion,
  isUnfinishedColorFlip,
  retireColor,
  startColor,
} from './color-lifecycle';
import { retireLegacyBackendTier } from './retire-legacy-backend';

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
  logger.info('  1. List the snapshots taken before deploys:');
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

    const currentVersion = await colorPlatformVersion(currentColor);
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
    // cancel the others; collect them and report together. Service → image
    // goes through `imageRef` and is de-duplicated: the backend roles run the
    // PLATFORM image, so a mechanical `tale-${service}` would try to pull
    // images that were never built.
    const rollbackImages = [
      ...new Set(
        ROTATABLE_SERVICES.map((service) => imageRef(serviceConfig, service)),
      ),
    ];
    const pullResults = await runStepsInParallel(
      rollbackImages.map((image) => ({
        label: image,
        run: async () => {
          if (!(await pull(image))) throw new Error(`pull failed: ${image}`);
        },
      })),
      { title: 'Pulling previous version images' },
    );
    const failedPulls = pullResults.filter((r) => !r.ok).map((r) => r.label);
    if (failedPulls.length > 0) {
      // The registry is an external dependency: exit 5, as documented.
      throw externalDepError(
        `Failed to pull ${failedPulls.length} image(s): ${failedPulls.join(', ')}`,
      );
    }

    // Ensure infrastructure exists before compose up. The config-store
    // rename runs first for the same reason it does on deploy: the generated
    // compose names `config-data`, and mounting it while the configuration
    // still sits in `convex-data` would roll back onto an empty config tree.
    await migrateConfigVolume(`${getProjectId()}_`);
    await ensureVolumes([...REQUIRED_VOLUMES]);
    await ensureNetwork('internal');

    const services = [...ROTATABLE_SERVICES];
    const replicas = getReplicaCounts();
    const pending = await getFlipPending(env.DEPLOY_DIR);
    const resume =
      pending !== null &&
      (await isUnfinishedColorFlip(
        env.DEPLOY_DIR,
        pending,
        services,
        replicas,
      ));
    const promoting =
      resume && pending !== null ? pending.promoting : rollbackColor;
    const retiring =
      resume && pending !== null ? pending.retiring : currentColor;

    if (!resume) {
      if (pending !== null) await clearFlipPending(env.DEPLOY_DIR);
      await setFlipPending(env.DEPLOY_DIR, { promoting, retiring });
    } else {
      logger.info(
        `Resuming the interrupted rollback onto ${promoting} (will not recreate a colour that is already up).`,
      );
    }

    // Bring the rollback colour up beside the live one, at the same replica
    // counts, and wait for every replica. Skip when resuming a colour that
    // is already answering — `startColor` would wipe it first.
    if (!(await colorLooksUp(promoting, services, replicas))) {
      logger.step(
        `Deploying ${promoting} services with version ${rollbackVersion}...`,
      );
      await startColor({
        color: promoting,
        services,
        compose: generateColorCompose(serviceConfig, promoting),
        replicas,
        cwd: env.DEPLOY_DIR,
        healthTimeout: env.HEALTH_CHECK_TIMEOUT,
      });
    }

    // Sweep a leftover pre-colour singleton before the long drain so it
    // cannot keep answering `backend-api` on the old image.
    await retireLegacyBackendTier();

    // Switch traffic and update version history
    logger.step(`Switching traffic to ${promoting}...`);
    await setCurrentColor(env.DEPLOY_DIR, promoting);
    await setPreviousVersion(env.DEPLOY_DIR, currentVersion);
    logger.info(`Version history updated: previous=${currentVersion}`);

    // Retire the colour that was live: drain it, wait, cut it out of DNS,
    // stop it — the same sequence a deploy uses, from the same module.
    if (retiring) {
      await retireColor({
        color: retiring,
        drainTimeout: env.DRAIN_TIMEOUT,
      });
    }

    await clearFlipPending(env.DEPLOY_DIR);

    logger.success(
      `Rollback complete! Version ${rollbackVersion} is now live on ${rollbackColor}`,
    );
  });
}
