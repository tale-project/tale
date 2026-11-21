import { sameMinor } from '../../utils/compare-versions';
import { externalDepError, preconditionError } from '../../utils/fail';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { runStepsInParallel } from '../../utils/progress';
import { confirm } from '../../utils/prompt';
import {
  appTierFor,
  askedAppTier,
  describeReplicas,
  tierReplicaCounts,
} from '../compose/app-tier';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import {
  memoryReservationNotice,
  reservedMemoryMib,
} from '../compose/services/memory-env';
import {
  ROTATABLE_SERVICES,
  imageRef,
  type ServiceConfig,
} from '../compose/types';
import { imageServesApp } from '../deployment/app-tier-image';
import { legacyLedgerShape } from '../deployment/automation-cutover-sql';
import {
  installedAutomationLedger,
  requireAutomationProtocol,
} from '../deployment/automation-protocol';
import {
  admitPendingAutomationColor,
  admitTagAutomationImage,
  tagDatabaseId,
  tagDeploymentProtocol,
} from '../deployment/tag-automation-protocol';
import type { pullImage } from '../docker/pull-image';
import { probeCgroupVersion } from '../docker/setup-checks';
import { IncusRuntime } from '../runtime/incus/incus-runtime';
import { selectRuntime } from '../runtime/select-runtime';
import type { StackRuntime } from '../runtime/types';
import {
  clearFlipPending,
  getFlipPending,
  setFlipPending,
} from '../state/flip-pending';
import { getCurrentColor } from '../state/get-current-color';
import { getOppositeColor } from '../state/get-opposite-color';
import { getPreviousVersion } from '../state/get-previous-version';
import { assertNoMigrationUnderWay } from '../state/migration-journal';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';
import {
  awaitRunningColorHealthy,
  colorProject,
  colorPlatformVersion,
  colorTier,
  planColorFlip,
  retireColor,
  startColor,
} from './color-lifecycle';
import { incusWorkspaceOf, rollbackOnIncus } from './incus-deploy';
import { retireLegacyBackendTier } from './retire-legacy-backend';

interface RollbackOptions {
  env: DeploymentEnv;
  /**
   * Skip the confirmation prompt (the command's `-y/--yes` flag). The global
   * `tale -y <cmd>` flag counts as consent too — see `resolveConsent`.
   */
  assumeYes?: boolean;
  /** The runtime to roll back on; selected from `tale.json` when absent. */
  runtime?: StackRuntime;
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
  logger.info(
    'back across versions, first check the automation writer protocol.',
  );
  logger.info(
    'After its cutover, use a compatible forward repair: restoring data',
  );
  logger.info('cannot undo external effects or authorize an old writer.');
  logger.info(
    'Only a separately verified compatible recovery can restore a snapshot:',
  );
  logger.info(
    '  0. If the application runs as one process (no backend-api container)',
  );
  logger.info(
    '     and the snapshot is from a release before that, bring its three',
  );
  logger.info('     services back first: set TALE_APP_TIER=three-services in');
  logger.info('     .env, then run:');
  logger.info('       tale deploy');
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
  const runtime = options.runtime ?? (await selectRuntime(env.DEPLOY_DIR));
  const pull = deps.pullImage ?? ((image: string) => runtime.pull(image));

  await withLock(env.DEPLOY_DIR, 'rollback', async () => {
    logger.header('Rolling Back Deployment');
    // A migration to Incus stopped the Docker stack on purpose.
    await assertNoMigrationUnderWay(env.DEPLOY_DIR, 'tale rollback');

    // Get current state
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    if (!currentColor) {
      logger.error('No active deployment to rollback from');
      throw new Error('No active deployment');
    }

    // Image-rollback gate: this command only swaps the running binary, so the
    // version boundary permits only a patch-level step. That is necessary,
    // not sufficient: the installed writer protocol is checked separately below.
    // Crossing a minor/major may have run forward-only data migrations; refuse
    // and require an independently verified recovery path.
    const rollbackVersion = await getPreviousVersion(env.DEPLOY_DIR);
    if (!rollbackVersion) {
      logger.error('No previous version recorded — nothing to roll back to.');
      printSnapshotRestoreRunbook();
      throw new Error('No previous version');
    }

    const currentVersion = await colorPlatformVersion(currentColor, runtime);
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
          'the version guard permits only patch-level rollbacks (same major.minor).',
      );
      printSnapshotRestoreRunbook();
      throw new Error('Rollback refused: not a patch-level rollback');
    }

    // An Incus stack started on automation writer protocol 2 and keeps it:
    // the legacy cutover is Docker's alone.
    const incus = runtime instanceof IncusRuntime ? runtime : null;
    const installedProtocol =
      incus === null ? await tagDeploymentProtocol(getProjectId(), true) : 2;
    // A cut first boot of the new release left part of its migrations in
    // this database (they were written to run beside v0.5.77, no older
    // release). Only `tale deploy` may finish that cutover.
    if (installedProtocol === 1) {
      const database = await tagDatabaseId(getProjectId());
      if (
        database !== null &&
        legacyLedgerShape(
          (await installedAutomationLedger(database, getProjectId(), {})).ids,
        ) === 'continued'
      )
        throw preconditionError(
          'An automation writer protocol cutover has begun upgrading this database. Finish it with `tale deploy`; rollback cannot cross it. Nothing was changed.',
        );
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

    // On Incus: the same flip toward the previous release, through the
    // switch, journaled so an interrupted rollback resumes (design 7.3).
    if (incus !== null) {
      await rollbackOnIncus({
        workspace: incusWorkspaceOf(incus, {
          env,
          hostAlias: process.env.HOST ?? 'localhost',
        }),
        currentColor,
        currentVersion,
        rollbackVersion,
      });
      logger.success(
        `Rollback complete! Version ${rollbackVersion} is now live on ${rollbackColor}`,
      );
      return;
    }

    const serviceConfig: ServiceConfig = {
      version: rollbackVersion,
      registry: env.GHCR_REGISTRY,
      cgroupVersion: await probeCgroupVersion(),
    };
    const reservationNotice = memoryReservationNotice(serviceConfig);
    if (reservationNotice) logger.warn(reservationNotice);
    // A shape named by a word that is none is refused before the pull.
    askedAppTier();

    // Pull previous-version images CONCURRENTLY, reporting each as a step so
    // progress + failure attribution stay clear. A single failure doesn't
    // cancel the others; collect them and report together. Service → image
    // goes through `imageRef` and is de-duplicated: the backend roles run the
    // PLATFORM image, so a mechanical `tale-${service}` would try to pull
    // images that were never built. Every name a service of the tier can
    // have is asked: which of them this image's colour runs is read below,
    // once the image is here.
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
    serviceConfig.platformImage = await admitTagAutomationImage(
      serviceConfig,
      installedProtocol,
    );

    // The colour takes the shape the image it runs was built for
    // (compose/app-tier.ts), read under the reference just admitted: a
    // release from before the app moved into the backend process comes back
    // as its three services, whatever shape the live colour has.
    const tier = appTierFor({
      appInBackend: await imageServesApp(imageRef(serviceConfig, 'platform')),
    });
    serviceConfig.appTier = tier;
    const services = [...tier.services];
    const replicas = tierReplicaCounts(tier);
    // What the live colour reserves is what the sandbox spawner was last told
    // to leave free, and a rollback leaves the spawner alone. Read for the
    // note at the end; a colour that cannot be read costs the note, never
    // the rollback.
    const reservedBefore = await colorTier(currentColor, runtime).then(
      (live) => (live === null ? null : reservedMemoryMib(live)),
      (error: unknown) => {
        logger.debug(
          `The live colour's shape could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      },
    );
    const pending = await getFlipPending(env.DEPLOY_DIR);
    // Decided once, like a deploy's (`planColorFlip`): a colour that is used
    // as it stands has every writer inspected against the admitted image, and
    // one that already holds the traffic is never started again.
    const flip = await planColorFlip({
      pending,
      current: currentColor,
      next: rollbackColor,
      tier,
      replicas,
      runtime,
    });
    const { promoting, retiring } = flip;

    if (flip.step !== 'start')
      await admitPendingAutomationColor(
        colorProject(promoting),
        serviceConfig.platformImage,
        installedProtocol,
        {},
        flip.services,
      );

    const checkInstalledWriter = async () =>
      requireAutomationProtocol(
        await tagDeploymentProtocol(getProjectId(), true),
        serviceConfig.platformImage === undefined ? 1 : 2,
      );
    await checkInstalledWriter();

    // Ensure infrastructure exists before compose up. The config-store
    // rename runs first for the same reason it does on deploy: the generated
    // compose names `config-data`, and mounting it while the configuration
    // still sits in `convex-data` would roll back onto an empty config tree.
    await runtime.migrateConfigVolume(`${getProjectId()}_`);
    await runtime.ensureVolumes(REQUIRED_VOLUMES);
    await runtime.ensureNetwork('internal');

    if (!flip.resumed) {
      if (pending !== null) await clearFlipPending(env.DEPLOY_DIR);
      await setFlipPending(env.DEPLOY_DIR, { promoting, retiring });
    } else if (flip.step === 'start') {
      logger.info(
        `Resuming the interrupted rollback onto ${promoting}: it serves nothing as it stands, so it is started again.`,
      );
    } else {
      logger.info(
        `Resuming the interrupted rollback onto ${promoting} (will not recreate a colour that is already up).`,
      );
    }

    // Bring the rollback colour up beside the live one, at the same replica
    // counts, and wait for every replica. Skip when resuming a colour that
    // is already answering — `startColor` would wipe it first.
    if (flip.step === 'start') {
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
        runtime,
      });
    } else {
      if (flip.runsInstead !== null)
        logger.warn(
          `The ${promoting} colour already holds the traffic and runs ${flip.runsInstead}, where this rollback asks for ${describeReplicas(tier, replicas)}. It is left as it is while the interrupted flip finishes.`,
        );
      // A colour left up by an interrupted rollback takes traffic only once
      // every replica is healthy.
      await awaitRunningColorHealthy({
        color: promoting,
        services: flip.services,
        replicas: flip.replicas,
        healthTimeout: env.HEALTH_CHECK_TIMEOUT,
        runtime,
      });
    }

    // Sweep a leftover pre-colour singleton before the long drain so it
    // cannot keep answering `backend-api` on the old image.
    await retireLegacyBackendTier(runtime);

    // Switch traffic and update version history
    logger.step(`Switching traffic to ${promoting}...`);
    await runtime.admit(colorProject(promoting), flip.services);
    await setCurrentColor(env.DEPLOY_DIR, promoting);
    await setPreviousVersion(env.DEPLOY_DIR, currentVersion);
    logger.info(`Version history updated: previous=${currentVersion}`);

    // Retire the colour that was live: drain it, wait, cut it out of DNS,
    // stop it — the same sequence a deploy uses, from the same module.
    if (retiring) {
      await retireColor({
        color: retiring,
        drainTimeout: env.DRAIN_TIMEOUT,
        runtime,
      });
    }

    await clearFlipPending(env.DEPLOY_DIR);

    logger.success(
      `Rollback complete! Version ${rollbackVersion} is now live on ${rollbackColor}`,
    );
    const reserved = reservedMemoryMib(tier);
    if (reservedBefore !== null && reservedBefore !== reserved)
      logger.warn(
        `The application now runs as ${tier.services.join(', ')} and reserves ${reserved}m with the database, where the colour before it reserved ${reservedBefore}m. A rollback leaves the sandbox spawner as it is, so it still leaves ${reservedBefore}m free for them (SANDBOX_RESERVED_MEMORY). \`tale deploy --services sandbox\` gives it the new sum.`,
      );
  });
}
