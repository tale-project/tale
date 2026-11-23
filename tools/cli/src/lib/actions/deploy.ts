import { lstatSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { externalDepError, preconditionError } from '../../utils/fail';
import {
  getProjectId,
  type DeploymentEnv,
  type ReplicaCounts,
} from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { runStepsInParallel } from '../../utils/progress';
import { BLOB_VOLUME, LEGACY_BLOB_VOLUME } from '../backup/constants';
import { createSnapshot } from '../backup/create-snapshot';
import { rotateSnapshots } from '../backup/rotate-snapshots';
import {
  apiService,
  appTierFor,
  askedAppTier,
  describeReplicas,
  THREE_WAY,
  tierReplicaCounts,
  unusedReplicaVariables,
  type AppTier,
} from '../compose/app-tier';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { generateStatefulCompose } from '../compose/generators/generate-stateful-compose';
import {
  selectDefaultServices,
  servicesKeepingHost,
} from '../compose/select-services';
import { potProviderAsked } from '../compose/services/create-bgutil-provider-service';
import { askedDbProfile } from '../compose/services/create-db-service';
import {
  memoryReservationNotice,
  reservedMemoryMib,
  unusedMemoryReservations,
} from '../compose/services/memory-env';
import {
  type RotatableService,
  type ServiceName,
  type ServiceConfig,
  type StatefulService,
  type StopGatedService,
  ALWAYS_ROLL_SERVICES,
  STOP_GATED_SERVICES,
  imageRef,
  isRotatableService,
  isStatefulService,
} from '../compose/types';
import type { RunOrigin } from '../config/dev-origin';
import { imageServesApp } from '../deployment/app-tier-image';
import { requireAutomationProtocol } from '../deployment/automation-protocol';
import {
  assessTagAutomationCutover,
  planTagAutomationCutover,
  runTagAutomationCutover,
  type TagCutoverPlan,
} from '../deployment/tag-automation-cutover';
import {
  admitPendingAutomationColor,
  admitTagAutomationImage,
  tagDeploymentProtocol,
} from '../deployment/tag-automation-protocol';
import { readSandboxNetworkSubnet } from '../docker/ensure-network';
import { migrateBlobStore } from '../docker/migrate-blob-store';
import {
  minioNotice,
  resolveObjectStore,
} from '../docker/resolve-object-store';
import { probeCgroupVersion } from '../docker/setup-checks';
import { discoverOrgs } from '../project/org-dirs';
import { IncusRuntime } from '../runtime/incus/incus-runtime';
import { selectRuntime } from '../runtime/select-runtime';
import type { StackRuntime } from '../runtime/types';
import {
  clearFlipPending,
  getFlipPending,
  setFlipPending,
} from '../state/flip-pending';
import { getCurrentColor } from '../state/get-current-color';
import { getNextColor } from '../state/get-next-color';
import { assertNoMigrationUnderWay } from '../state/migration-journal';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';
import {
  awaitRunningColorHealthy,
  colorLooksUp,
  colorPlatformVersion,
  colorProject,
  colorTier,
  planColorFlip,
  retireColor,
  startColor,
  type ColorFlip,
} from './color-lifecycle';
import {
  BACKEND_API_LABEL,
  backendApiContainer,
  drainBackend,
  endDrainBackend,
} from './drain-backend';
import { drainSandbox } from './drain-sandbox';
import {
  deployOnIncus,
  incusWorkspaceOf,
  type WorkspacePlan,
} from './incus-deploy';
import { reseedAllOrgsFromBuiltin } from './reseed-all-orgs';
import { gatewayRetired, retireGateway } from './retire-gateway';
import { retireLegacyBackendTier } from './retire-legacy-backend';

/** What a deploy says of the PO-token provider it does not run. */
const POT_PROVIDER_OFF =
  'video links get no PO tokens for YouTube unless VIDEO_INGEST_POT_PROVIDER=true is in .env.';

async function ensureInfrastructure(
  prefix: string,
  dryRun: boolean,
  runtime: StackRuntime,
): Promise<void> {
  logger.step(`${prefix}Ensuring volumes and network exist...`);
  if (dryRun) {
    logger.info(
      `${prefix}Would migrate the org config store to ${getProjectId()}_config-data if it still lives in ${getProjectId()}_convex-data`,
    );
    for (const vol of REQUIRED_VOLUMES) {
      logger.info(`${prefix}Would ensure volume: ${getProjectId()}_${vol}`);
    }
    logger.info(`${prefix}Would ensure network: ${getProjectId()}_internal`);
    return;
  }

  // One-time config-store rename, BEFORE anything mounts a volume: the
  // compose files below name `config-data`, and mounting that while the
  // configuration still sits in `convex-data` would start the deployment
  // with an empty config tree. Throws on a failed copy, which aborts the
  // deploy with the old volume intact.
  await runtime.migrateConfigVolume(`${getProjectId()}_`);

  const volumesCreated = await runtime.ensureVolumes(REQUIRED_VOLUMES);
  if (!volumesCreated) {
    throw new Error('Failed to create required volumes');
  }
  const networkCreated = await runtime.ensureNetwork('internal');
  if (!networkCreated) {
    throw new Error('Failed to create required network');
  }
  // Sandbox bridge: fixed name `tale-sandbox-net`, internal-only, IPv6 off.
  const sandboxNetworkCreated = await runtime.ensureSandboxNetwork();
  if (!sandboxNetworkCreated) {
    throw new Error('Failed to create sandbox network');
  }
}

interface DeployOptions {
  version: string;
  /**
   * Opt into updating the stop-gated tier (`db`, `proxy`) even while it's
   * running — accepts the brief downtime of recreating Postgres / the proxy.
   * Without it, a running stop-gated service is left untouched (with a hint).
   */
  stop: boolean;
  env: DeploymentEnv;
  hostAlias: string;
  /**
   * The host this run serves instead of `.env`'s HOST and SITE_URL
   * (`tale deploy --host`). `.env` is not changed.
   */
  origin?: RunOrigin;
  dryRun: boolean;
  services?: ServiceName[];
  override?: boolean;
  /**
   * Factory-reseed builtin → all orgs after deploy completes. Triggers a
   * server-side reseed action; preserves *.secrets.json, .history/, and
   * uploaded branding/images/. Combined with `override`, host-push runs
   * first, then the all-orgs reseed. Asks nothing: the caller has resolved
   * the operator's consent before the deploy began (`confirmOverrideAll`).
   */
  overrideAll?: boolean;
  quiet?: boolean;
  /**
   * Set by the caller when `ensureEnv` filled in auto-gen secrets headlessly
   * (e.g. an upgrade silently materialized `SANDBOX_TOKEN`). All subsequent
   * `docker compose up -d` invocations gain `--force-recreate` so containers
   * that were already running on an unchanged image pick up the new value
   * — without this, the spawner could keep its pre-rotation null token in
   * memory while Convex picks up the new one, breaking the HMAC handshake
   * until the next manual restart.
   */
  forceRecreate?: boolean;
  /**
   * Skip the pre-deploy volume snapshot. Logged loudly — without the
   * snapshot, recovery from a failed migration falls back to whatever
   * external backups the operator maintains.
   */
  skipBackup?: boolean;
  /**
   * The runtime `tale deploy` selected for this workspace. Without it the
   * deploy selects from `tale.json` itself.
   */
  runtime?: StackRuntime;
  /** `--plan <file>` on Incus: apply only what this reviewed plan holds. */
  plan?: WorkspacePlan;
  /** `--clear-sandbox-placement` on Incus: leaving
   * `runtime.incus.sandboxHosts`, delete the spawner's record of each
   * session's host. */
  clearSandboxPlacement?: boolean;
  /** The caller holds the deploy lock already (`tale runtime migrate`). */
  lockHeld?: boolean;
}

export async function deploy(options: DeployOptions): Promise<void> {
  const { version, stop, env, hostAlias, origin, dryRun, services } = options;
  const streamLogs = !options.quiet && (process.stdout.isTTY ?? false);
  const runtime = options.runtime ?? (await selectRuntime(env.DEPLOY_DIR));

  // Colour projects started during this deploy but not yet live — torn down
  // on interrupt. A project, not a list of names: the replicas are named by
  // compose, so the only stable handle is the project label.
  const startedColorProjects: string[] = [];
  // Track tmp staging dirs created by syncProjectFiles so interrupts don't leak /tmp/tale-sync-*
  const tempStageDirs = new Set<string>();
  let interrupted = false;

  const onInterrupt = () => {
    if (interrupted) return;
    interrupted = true;
    logger.blank();
    logger.warn('Deployment interrupted, cleaning up started containers...');
    runtime.onInterrupt(startedColorProjects);
    for (const stageDir of tempStageDirs) {
      try {
        Bun.spawnSync(['rm', '-rf', stageDir]);
      } catch (err) {
        logger.warn(
          `Failed to clean up stage dir ${stageDir}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
    process.kill(process.pid, 'SIGINT');
  };

  if (!dryRun) {
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);
  }

  try {
    const locked = (work: () => Promise<void>) =>
      options.lockHeld === true
        ? work()
        : withLock(env.DEPLOY_DIR, `deploy ${version}`, work);
    await locked(async () => {
      const prefix = dryRun ? '[DRY-RUN] ' : '';
      // A migration to Incus stopped the Docker stack on purpose.
      if (options.lockHeld !== true && !dryRun)
        await assertNoMigrationUnderWay(env.DEPLOY_DIR, 'tale deploy');

      // What every deploy does once the services are rolled, on either
      // runtime: the host config push and the reseed.
      const finish = async () => {
        if (dryRun) {
          logger.success(
            `${prefix}Dry-run complete! Would deploy version ${version}`,
          );
        } else {
          // Containers are now rolled. Don't print "Deployment complete!"
          // yet — that announces success over the wire, but sync + reseed
          // still run below and either can abort the deploy.
          logger.info(`${prefix}Services updated to version ${version}.`);
        }

        // Sync project files to the backend api container — the tier that
        // mounts the org config store (the `config-data` volume) read-WRITE.
        // On Incus the copy writes the volume through its file API, as the
        // app's uid and gid.
        await syncProjectFiles(
          await backendApiContainer(null, runtime),
          env.DEPLOY_DIR,
          dryRun,
          prefix,
          tempStageDirs,
          options.override ?? false,
          runtime,
        );

        // After deploy + optional host-push, trigger the server-side reseed of
        // the builtin catalog into every org, through the backend's control
        // door. Its consent was resolved before the deploy began.
        if (options.overrideAll) {
          await reseedAllOrgsFromBuiltin({ dryRun, runtime });
        }

        if (!dryRun) {
          logger.success(`Deployment complete! Version ${version} is now live`);
        }
      };

      // The workspace path on Incus (design 7.2, 7.3): scope by scope, then
      // the flip through the switch, or the roll of `--services`.
      if (runtime instanceof IncusRuntime) {
        logger.header(`${prefix}Deploying Tale ${version}`);
        await deployOnIncus({
          workspace: incusWorkspaceOf(runtime, {
            env,
            hostAlias,
            ...(origin === undefined ? {} : { origin }),
            stop,
          }),
          version,
          dryRun,
          ...(services === undefined ? {} : { services }),
          ...(options.plan === undefined ? {} : { plan: options.plan }),
          ...(options.override === undefined
            ? {}
            : { override: options.override }),
          ...(options.overrideAll === undefined
            ? {}
            : { overrideAll: options.overrideAll }),
          ...(options.skipBackup === undefined
            ? {}
            : { skipBackup: options.skipBackup }),
          ...(options.clearSandboxPlacement
            ? { clearSandboxPlacement: true }
            : {}),
        });
        await finish();
        return;
      }
      if (options.plan !== undefined)
        throw preconditionError(
          'A reviewed plan (--plan) applies to a workspace on the Incus runtime.',
        );
      logger.header(`${prefix}Deploying Tale ${version}`);

      // Check if this is a first-time deployment
      const currentColor = await getCurrentColor(env.DEPLOY_DIR);
      const isFirstDeploy = currentColor === null;
      const installedProtocol = await tagDeploymentProtocol(
        getProjectId(),
        !isFirstDeploy,
      );
      // A protocol-1 host crosses the automation writer protocol cutover when
      // the admitted image is protocol 2; its messages name what runs now.
      const legacyVersion =
        installedProtocol === 1 && currentColor !== null
          ? await colorPlatformVersion(currentColor, runtime)
          : null;
      let cutover: TagCutoverPlan | null = null;

      // Determine which services to deploy. Of the application tier this
      // names what was ASKED for: all of it on a default deploy, the services
      // `--services` listed otherwise. Which services the tier has is its
      // image's to say (compose/app-tier.ts) and is settled once the image is
      // on this host, below; until then the list only says that the platform
      // image is needed.
      let rotatableToUpdate: RotatableService[];
      let statefulToUpdate: StatefulService[];

      if (services && services.length > 0) {
        // User specified explicit services
        rotatableToUpdate = services.filter(isRotatableService);
        statefulToUpdate = services.filter(isStatefulService);
      } else {
        // Default deploy uses the three-tier policy (see select-services.ts):
        // the application tier (platform, backend-api, backend-worker)
        // blue-green; the always-roll tier (sandbox, sandbox-egress) rolls
        // in place via the stateful compose (sandbox drained first via
        // /v1/drain); stop-gated (db, proxy) only when stopped / first
        // deploy / --stop, else left running with a hint.
        const runningState = new Map<StopGatedService, boolean>();
        for (const service of STOP_GATED_SERVICES) {
          runningState.set(
            service,
            await runtime.isRunning(`${getProjectId()}-${service}`),
          );
        }
        const selection = selectDefaultServices({
          isFirstDeploy,
          stop,
          isStopGatedRunning: (s) => runningState.get(s) ?? false,
        });
        rotatableToUpdate = selection.rotatable;
        statefulToUpdate = selection.stateful;

        if (isFirstDeploy) {
          logger.notice(
            'First deployment detected — including infrastructure services',
          );
        }
        if (selection.leftRunning.length > 0) {
          logger.warn(
            `Left running, not updated: ${selection.leftRunning.join(', ')}. ` +
              'Re-run with `tale deploy --stop` to update them (brief downtime).',
          );
        }
      }

      if (rotatableToUpdate.length === 0 && statefulToUpdate.length === 0) {
        logger.error('No valid services to deploy');
        throw new Error('No services specified');
      }

      // Determine deployment mode
      const inPlaceUpdate = services && services.length > 0;
      if (inPlaceUpdate) {
        logger.info('Mode: In-place update (no blue-green switching)');
      } else {
        logger.info('Mode: Blue-green deployment');
      }
      logger.info(
        `Stateful services: ${statefulToUpdate.join(', ') || 'none'}`,
      );

      // Which blob store this deployment runs is what its volumes hold,
      // read before the pull: the image depends on it. Blobs in MinIO's
      // volume move to versitygw on a deploy that replaces the store
      // (`--stop`, a store that is not running, `--services object-store`):
      // the move pauses the application, as replacing a stop-gated service
      // stops it. Any other deploy keeps MinIO.
      const blobsIn = await resolveObjectStore(`${getProjectId()}_`, runtime);
      const moveBlobs =
        blobsIn === 'minio' && statefulToUpdate.includes('object-store');
      if (blobsIn === 'minio' && !moveBlobs) {
        logger.info(
          `${minioNotice(`${getProjectId()}_`)} \`tale deploy --stop\` moves the blobs to versitygw, pausing the application for the last copy.`,
        );
      }
      const serviceConfig: ServiceConfig = {
        version,
        registry: env.GHCR_REGISTRY,
        cgroupVersion: await probeCgroupVersion(),
        objectStore: moveBlobs ? 'versitygw' : blobsIn,
      };
      const reservationNotice = memoryReservationNotice(serviceConfig);
      if (reservationNotice) logger.warn(reservationNotice);
      // A shape named by a word that is none is refused here, like a size
      // above: before this deploy pulls, retags or snapshots anything. So is
      // a database profile the image does not know.
      askedAppTier();
      askedDbProfile();
      const potProvider = potProviderAsked();

      // Pull all required images first. The sandbox tier (sandbox +
      // sandbox-egress) is now a stateful always-roll singleton, so its images
      // are pulled here via statefulToUpdate like the rest — no special-casing.
      // Service → image goes through imageRef (shared with the compose
      // creators): the backend tier runs the platform image, so a mechanical
      // `tale-${service}` would pull images that were never built. Dedup'd
      // because several services can share one image.
      logger.step(`${prefix}Pulling images...`);
      const imagesToPull = [
        ...new Set(
          [...rotatableToUpdate, ...statefulToUpdate].map((s) =>
            imageRef(serviceConfig, s),
          ),
        ),
      ];

      // The spawner's runtime image (consumed by `docker run` of user code,
      // not a compose service) must also be pulled and re-tagged to match the
      // spawner's `SANDBOX_RUNTIME_IMAGE` default (`tale-sandbox-runtime:latest`).
      // Without this, a fresh deploy host has no local runtime image and the
      // first /v1/execute fails with image-not-found. Mirrors build.yml's
      // re-tag step. Needed whenever the sandbox tier rolls — i.e. whenever
      // sandbox is in statefulToUpdate — since the runtime image versions in
      // lockstep with the spawner.
      const needsRuntimeImage =
        statefulToUpdate.includes('sandbox') ||
        statefulToUpdate.includes('sandbox-egress');
      const runtimeImageRemote = needsRuntimeImage
        ? `${env.GHCR_REGISTRY}/tale-sandbox-runtime:${version}`
        : null;
      if (runtimeImageRemote) {
        imagesToPull.push(runtimeImageRemote);
      }

      // The shared buildkitd image (also `docker run` by the spawner, not a
      // compose service) needs the same pull + re-tag to the spawner's
      // SANDBOX_BUILDKITD_IMAGE default (`tale-sandbox-buildkitd:latest`) so a
      // deployment that enables the shared build cache has it locally. Tied to
      // the same condition as the runtime image (versions in lockstep). It is
      // only RUN when SANDBOX_DOCKER_BUILD_CACHE is on, so this is a small pull
      // some deployments won't use — flag-gating it (reading deployment.json)
      // is a future refinement.
      const buildkitdImageRemote = needsRuntimeImage
        ? `${env.GHCR_REGISTRY}/tale-sandbox-buildkitd:${version}`
        : null;
      if (buildkitdImageRemote) {
        imagesToPull.push(buildkitdImageRemote);
      }

      // Whether the platform image serves the app from its backend process
      // (`io.tale.app-in-backend`), which decides the services a colour of it
      // runs. Null until the image is on this host: for good where this
      // deploy needs no platform image, and through a dry run of one that is
      // not pulled yet.
      let appInBackend: boolean | null = null;

      // Set by a dry run whose target image is not on this host yet: the real
      // deploy reads its protocol after the pull, so until then there is no
      // target to compare the installed writer with.
      let targetUnpulled = false;
      const checkInstalledWriter = async () => {
        if (rotatableToUpdate.length === 0 || targetUnpulled) return;
        requireAutomationProtocol(
          await tagDeploymentProtocol(getProjectId(), !isFirstDeploy),
          serviceConfig.platformImage === undefined ? 1 : 2,
        );
      };

      // The shape of the application tier this deploy leaves live, which
      // every generator below builds from (`serviceConfig.appTier`).
      //
      // A NEW colour takes the shape its image runs and the deployment asked
      // for. An in-place update replaces containers of the live colour AS IT
      // IS, so it keeps that colour's shape and names services it has. A
      // deploy that touches no application service still tells the sandbox
      // what the live colour reserves.
      //
      // Called once the platform image has said what it runs, and before this
      // deploy retags, snapshots or replaces anything: what it refuses, it
      // refuses with the host as it found it.
      const settleAppTier = async (): Promise<{
        tier: AppTier;
        replicas: ReplicaCounts;
      }> => {
        const liveTier = async () =>
          currentColor === null ? null : colorTier(currentColor, runtime);
        let tier: AppTier;
        if (rotatableToUpdate.length === 0) {
          // Nothing of the tier is touched. Where no colour is up either,
          // the three services stand in: the larger reservation, which the
          // next deploy of the tier replaces with its own.
          tier = (await liveTier()) ?? THREE_WAY;
        } else {
          const live = inPlaceUpdate ? await liveTier() : null;
          if (live === null) {
            tier = appTierFor({ appInBackend: appInBackend ?? true });
            if (appInBackend === null)
              logger.info(
                `${prefix}${imageRef(serviceConfig, 'platform')} is not on this host yet, and the image says which services its colour runs. This preview shows the ones an image of this release runs; one from before the app moved into the backend process runs platform, backend-api and backend-worker.`,
              );
          } else {
            if (appInBackend === false && live.shape !== 'three-way')
              // Its `platform` would start in a role that image does not
              // serve the app from, and never report healthy.
              throw preconditionError(
                `The live ${currentColor} colour runs the application as ${live.services.join(' and ')}, which ${imageRef(serviceConfig, 'platform')} cannot: that image is from before the app moved into the backend process. Run \`tale deploy\` without --services: it starts a colour in the shape the image runs and switches to it.`,
              );
            tier = live;
          }
          if (!inPlaceUpdate) {
            rotatableToUpdate = [...tier.services];
          } else if (currentColor !== null) {
            // With no colour recorded there is nothing to update in place,
            // which the update itself says, below.
            const absent = rotatableToUpdate.filter(
              (service) => !tier.services.includes(service),
            );
            if (absent.length > 0)
              throw preconditionError(
                `The ${currentColor} colour runs ${tier.services.join(', ')}: it has no ${absent.join(' or ')} to update. Name a service it runs, or run \`tale deploy\` without --services to start a colour of another shape.`,
              );
          }
        }
        serviceConfig.appTier = tier;
        // The sizes were read once before the pull, for a colour of three
        // services. Read again for this shape, where `platform` may be a
        // backend process under the backend's memory limit, so a size Docker
        // would refuse still fails here, not at `compose up`.
        reservedMemoryMib(tier);
        logger.info(
          `Rotatable services: ${rotatableToUpdate.join(', ') || 'none'}`,
        );
        // Set for a service this colour does not run: said once, so a count
        // that scales nothing or a reservation that protects nothing is not
        // mistaken for one that does.
        const unused = [
          ...unusedReplicaVariables(tier),
          ...unusedMemoryReservations(tier),
        ];
        if (rotatableToUpdate.length > 0 && unused.length > 0)
          logger.warn(
            `${unused.join(', ')} ${unused.length === 1 ? 'is' : 'are'} set for a service this colour does not run (it runs ${tier.services.join(' and ')}) and ${unused.length === 1 ? 'has' : 'have'} no effect. TALE_PLATFORM_REPLICAS and PLATFORM_MEMORY_RESERVATION size platform.`,
          );
        const keepHost = origin
          ? servicesKeepingHost(
              [...rotatableToUpdate, ...statefulToUpdate],
              tier,
            )
          : [];
        if (origin && keepHost.length > 0) {
          logger.warn(
            `--host ${origin.host} does not reach ${keepHost.join(', ')}: not recreated by this deploy, they keep the host they were started with. ` +
              (services && services.length > 0
                ? 'Add them to --services to recreate them.'
                : 'Re-run with `tale deploy --stop` to recreate them (brief downtime).'),
          );
        }
        // How many replicas of each of the colour's services to run.
        return { tier, replicas: tierReplicaCounts(tier) };
      };
      let settled: Awaited<ReturnType<typeof settleAppTier>>;
      // What a flip does with the colour it promotes; null in a dry run and
      // where this deploy flips nothing.
      let flip: ColorFlip | null = null;

      if (dryRun) {
        for (const image of imagesToPull) {
          logger.info(`${prefix}Would pull: ${image}`);
        }
        if (rotatableToUpdate.length > 0 && installedProtocol === 2) {
          // Admission inspects the pulled image, and a dry run pulls nothing:
          // an image already here is admitted as the deploy would, one not
          // pulled yet leaves its check to the deploy.
          const target = imageRef(serviceConfig, 'platform');
          if (await runtime.imagePresent(target)) {
            serviceConfig.platformImage = await admitTagAutomationImage(
              serviceConfig,
              installedProtocol,
            );
          } else {
            targetUnpulled = true;
            logger.info(
              `${prefix}Would check after pulling that ${target} is an automation writer protocol 2 image (v0.5.78 or later) proving its source, version and repository digest. It is not on this host yet, so this preview skips that check.`,
            );
          }
        }
        if (rotatableToUpdate.length > 0 && installedProtocol === 1) {
          // The target's protocol is known only once its image is pulled.
          // Every release since v0.5.78 is protocol 2, so say what crossing
          // would need, and refuse nothing: a dry run only reports.
          try {
            const state = await assessTagAutomationCutover({
              project: getProjectId(),
              runningVersion: legacyVersion,
              release: version,
              deployDir: env.DEPLOY_DIR,
              firstDeploy: isFirstDeploy,
            });
            if (state !== 'none')
              logger.info(
                `${prefix}${state === 'resume' ? 'Would finish' : 'Would run'} the one-time automation writer protocol cutover (a v0.5.78 or later image): stop the ${legacyVersion ?? 'old'} backend under a held census of automation runs, then start the new colour.${inPlaceUpdate ? ' It needs a full deploy: --services would be refused.' : ''}${stop ? ' It keeps the database container: --stop would be refused.' : ''}`,
              );
          } catch (error) {
            logger.warn(
              `${prefix}${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        await checkInstalledWriter();
        if (rotatableToUpdate.length > 0) {
          // The image says which services its colour runs, and a dry run
          // pulls nothing: one already here is read as the deploy would read
          // it, one not pulled yet is previewed as this release's image.
          const target = imageRef(serviceConfig, 'platform');
          if (await runtime.imagePresent(target))
            appInBackend = await imageServesApp(target);
        }
        settled = await settleAppTier();
        if (runtimeImageRemote) {
          logger.info(
            `${prefix}Would tag: ${runtimeImageRemote} -> tale-sandbox-runtime:latest`,
          );
        }
        if (buildkitdImageRemote) {
          logger.info(
            `${prefix}Would tag: ${buildkitdImageRemote} -> tale-sandbox-buildkitd:latest`,
          );
        }
      } else {
        // Pull all images CONCURRENTLY (docker dedups shared layers), but log
        // each one's completion as a step so the terminal still reads like a
        // sequential checklist. One failed pull doesn't cancel the others —
        // we collect every failure and report them together.
        const pullResults = await runStepsInParallel(
          imagesToPull.map((image) => ({
            label: image,
            run: async () => {
              if (!(await runtime.pull(image))) {
                throw new Error(`pull failed: ${image}`);
              }
            },
          })),
          { title: `${prefix}Pulling images` },
        );
        const failedImages = pullResults
          .filter((r) => !r.ok)
          .map((r) => r.label);
        if (failedImages.length > 0) {
          // The registry is an external dependency: exit 5, as documented.
          throw externalDepError(
            `Failed to pull ${failedImages.length} image(s): ${failedImages.join(', ')}\n` +
              'If this is a recent release, the container images may still be building and testing. ' +
              'Please wait a few minutes and try again.',
          );
        }
        if (rotatableToUpdate.length > 0) {
          serviceConfig.platformImage = await admitTagAutomationImage(
            serviceConfig,
            installedProtocol,
            {},
            { legacyCutover: true },
          );
          // Everything the cutover can refuse is asked here, read-only, before
          // this deploy retags, snapshots or replaces anything.
          cutover = await planTagAutomationCutover({
            project: getProjectId(),
            registry: env.GHCR_REGISTRY,
            platformImage: serviceConfig.platformImage,
            runningVersion: legacyVersion,
            release: version,
            deployDir: env.DEPLOY_DIR,
            firstDeploy: isFirstDeploy,
            stop,
            inPlace: Boolean(inPlaceUpdate),
          });
          // Read under the reference the colour's compose will name: the
          // digest just admitted, where the image is a protocol-2 one.
          appInBackend = await imageServesApp(
            imageRef(serviceConfig, 'platform'),
          );
        }
        settled = await settleAppTier();
        if (rotatableToUpdate.length > 0) {
          const pending = await getFlipPending(env.DEPLOY_DIR);
          if (inPlaceUpdate) {
            // The idle colour takes no part in an update in place, but
            // writers an earlier deploy left running there are held to the
            // admitted image all the same.
            const idle = pending?.promoting ?? getNextColor(currentColor);
            if (
              await colorLooksUp(
                idle,
                rotatableToUpdate,
                settled.replicas,
                runtime,
              )
            )
              await admitPendingAutomationColor(
                colorProject(idle),
                serviceConfig.platformImage,
                installedProtocol,
                {},
                rotatableToUpdate,
              );
          } else {
            // What the flip does with the colour it promotes is decided
            // once, here, so the check below and the bring-up further down
            // cannot disagree: a colour that is used as it stands, because
            // it is up as asked or because it already holds the traffic, has
            // every writer inspected against the admitted image, not only
            // the image just pulled.
            flip = await planColorFlip({
              pending,
              current: currentColor,
              next: getNextColor(currentColor),
              tier: settled.tier,
              replicas: settled.replicas,
              runtime,
            });
            if (flip.step !== 'start')
              await admitPendingAutomationColor(
                colorProject(flip.promoting),
                serviceConfig.platformImage,
                installedProtocol,
                {},
                flip.services,
              );
          }
        }
        await checkInstalledWriter();
        if (runtimeImageRemote) {
          const tagResult = await runtime.tag(
            runtimeImageRemote,
            'tale-sandbox-runtime:latest',
          );
          if (!tagResult.success) {
            throw new Error(
              `Failed to re-tag sandbox runtime image: ${tagResult.stderr.trim()}`,
            );
          }
        }
        if (buildkitdImageRemote) {
          const tagResult = await runtime.tag(
            buildkitdImageRemote,
            'tale-sandbox-buildkitd:latest',
          );
          if (!tagResult.success) {
            throw new Error(
              `Failed to re-tag sandbox buildkitd image: ${tagResult.stderr.trim()}`,
            );
          }
        }
      }

      const { tier, replicas } = settled;

      // Pre-mutation volume snapshot — the recovery point for forward-only
      // migrations. Taken whenever this deploy can change data: a version
      // change (new images run implicit migrations on first boot) or a
      // host-config push. First deploys have nothing to snapshot yet;
      // snapshot failure aborts the deploy unless the operator opted out
      // via --skip-backup.
      if (!isFirstDeploy) {
        const snapshotPrefix = `${getProjectId()}_`;
        const runningVersion = await colorPlatformVersion(
          currentColor,
          runtime,
        );
        const wouldMutate =
          runningVersion !== version ||
          Boolean(options.override) ||
          Boolean(options.overrideAll);
        if (wouldMutate) {
          if (dryRun) {
            logger.info(
              `${prefix}Would create pre-deploy volume snapshot in ${snapshotPrefix}backups (and rotate old ones)`,
            );
          } else if (options.skipBackup) {
            logger.warn(
              '--skip-backup: skipping the pre-deploy volume snapshot — if this deploy migrates data, recovery falls back to your own external backups.',
            );
          } else {
            await createSnapshot({
              prefix: snapshotPrefix,
              trigger: 'deploy',
              platformVersion: runningVersion,
              runtime,
            });
            await rotateSnapshots({ prefix: snapshotPrefix, runtime });
          }
        }
      }

      // Must run AFTER migrations (which may `docker compose down`, removing
      // networks) and BEFORE any `docker compose up` for stateful or rotatable
      // services.
      await checkInstalledWriter();
      await ensureInfrastructure(prefix, dryRun, runtime);
      // The model relay in the app tier binds its address in the sandbox
      // network alone, which exists from here on.
      if (!dryRun) {
        const subnet = await readSandboxNetworkSubnet();
        if (subnet !== undefined) serviceConfig.sandboxNetworkSubnet = subnet;
      }

      // The move of the blobs from MinIO to versitygw, with both volumes
      // there now and before the stateful services converge
      // (docker/migrate-blob-store.ts). A move that does not happen leaves
      // the store MinIO for this deploy, and says why.
      if (moveBlobs) {
        const minioVolume = `${getProjectId()}_${LEGACY_BLOB_VOLUME}`;
        if (dryRun) {
          logger.info(
            `${prefix}Would move the blobs from ${minioVolume} to versitygw on ${getProjectId()}_${BLOB_VOLUME}, pausing the application for the last copy`,
          );
        } else {
          const store = `${getProjectId()}-object-store`;
          const move = await migrateBlobStore({
            prefix: `${getProjectId()}_`,
            project: getProjectId(),
            accessKey: process.env.OBJECT_STORE_ACCESS_KEY?.trim() || 'tale',
            secretKey: process.env.OBJECT_STORE_SECRET_KEY?.trim() ?? '',
            convergeStore: async (engine) => {
              const up = await runtime.converge(
                {
                  stack: getProjectId(),
                  compose: generateStatefulCompose(
                    { ...serviceConfig, objectStore: engine },
                    hostAlias,
                    origin,
                  ),
                  cwd: env.DEPLOY_DIR,
                },
                { services: ['object-store'], forceRecreate: false },
              );
              if (!up.success) {
                logger.warn(
                  `${prefix}The store did not start as ${engine}: ${up.stderr.trim().slice(0, 300) || 'no stderr captured'}`,
                );
                return false;
              }
              return runtime.waitHealthy(store, {
                timeout: env.HEALTH_CHECK_TIMEOUT,
                streamLogs,
              });
            },
          });
          if (!move.moved) {
            serviceConfig.objectStore = 'minio';
            logger.warn(
              `${prefix}The blobs stay in MinIO (${minioVolume}), which serves them as before: ${move.reason}.`,
            );
          }
        }
      }

      // Deploy stateful services if any
      if (statefulToUpdate.length > 0) {
        logger.step(`${prefix}Deploying stateful services...`);
        const statefulCompose = generateStatefulCompose(
          serviceConfig,
          hostAlias,
          origin,
        );

        // Where the always-roll tier converges, the model gateway an earlier
        // release left is retired once the backend says no key it minted is
        // open (retire-gateway.ts). It is no service of the stateful document
        // any more, so the converge below leaves its container as it is.
        const rollsAlwaysRollTier = ALWAYS_ROLL_SERVICES.some((service) =>
          statefulToUpdate.includes(service),
        );

        // Will this deploy actually recreate the sandbox spawner? Same logic as
        // the backend tier: drain in-flight one-shot executions only when the single
        // sandbox container's image version is changing (or a forced recreate),
        // so a no-op deploy doesn't refuse executions for nothing.
        const sandboxWillRecreate =
          !isFirstDeploy &&
          statefulToUpdate.includes('sandbox') &&
          (Boolean(options.forceRecreate) ||
            (await runtime.version(`${getProjectId()}-sandbox`)) !== version);

        if (dryRun) {
          if (sandboxWillRecreate) {
            await drainSandbox({ dryRun: true, runtime });
          }
          for (const service of statefulToUpdate) {
            logger.info(`${prefix}Would deploy stateful service: ${service}`);
          }
          if (potProvider) {
            logger.info(
              `${prefix}Would deploy bgutil-provider sidecar (separate, non-blocking)`,
            );
          } else if (
            await runtime.exists(`${getProjectId()}-bgutil-provider`)
          ) {
            logger.info(
              `${prefix}Would remove the bgutil-provider sidecar: ${POT_PROVIDER_OFF}`,
            );
          }
          if (rollsAlwaysRollTier)
            await retireGateway({ dryRun: true, runtime });
        } else {
          // Drain in-flight sandbox executions before the single spawner is
          // recreated below (the tier dropped blue-green — one container rolled
          // in place). Best-effort (see drain-sandbox.ts); the spawner's SIGTERM
          // drain + stop_grace_period backstops anything that outlasts the
          // budget.
          if (sandboxWillRecreate) {
            await drainSandbox({ dryRun: false, runtime });
          }

          const result = await runtime.converge(
            {
              stack: getProjectId(),
              compose: statefulCompose,
              cwd: env.DEPLOY_DIR,
            },
            {
              services: statefulToUpdate,
              forceRecreate: Boolean(options.forceRecreate),
            },
          );

          if (!result.success) {
            logger.error('Failed to deploy stateful services');
            logger.error(result.stderr);
            throw new Error(
              `Stateful deployment failed: ${result.stderr.trim().slice(0, 500) || 'no stderr captured'}`,
            );
          }

          // The stateful tier rolls in place: `up -d` above has already
          // replaced the previous db/proxy/backend containers, so there is no
          // predecessor to fall back to. They are deliberately NOT registered
          // for teardown on interrupt — `startedContainers` is for the new
          // blue-green colour that has not taken traffic yet; force-removing
          // a healthy singleton Postgres on Ctrl-C would turn a cancelled
          // deploy into a full outage.

          // Wait for stateful services to be healthy
          for (const service of statefulToUpdate) {
            const containerName = `${getProjectId()}-${service}`;
            const healthy = await runtime.waitHealthy(containerName, {
              timeout: env.HEALTH_CHECK_TIMEOUT,
              streamLogs,
            });
            if (!healthy) {
              throw new Error(`Service ${service} failed health check`);
            }
          }

          // bgutil PO-token provider — where the deployment asked for it,
          // brought up SEPARATELY and best-effort after the core services are
          // healthy. It's a third-party image (not a `tale-*` build in the
          // always-roll tier), so a pull/start failure must never fail the
          // core deploy, and YouTube ingestion degrades gracefully (no PO
          // token) if it never starts.
          const sidecar = `${getProjectId()}-bgutil-provider`;
          if (potProvider) {
            const bgutilUp = await runtime.converge(
              {
                stack: getProjectId(),
                compose: statefulCompose,
                cwd: env.DEPLOY_DIR,
              },
              {
                services: ['bgutil-provider'],
                forceRecreate: Boolean(options.forceRecreate),
              },
            );
            if (!bgutilUp.success) {
              logger.warn(
                `${prefix}bgutil-provider sidecar did not start (YouTube ingestion falls back to no PO token): ${bgutilUp.stderr.trim().slice(0, 300) || 'no stderr captured'}`,
              );
            }
          } else if (await runtime.exists(sidecar)) {
            // One an earlier deploy started, when every deployment had one.
            // Nothing in the stateful document names it any more, so nothing
            // else would ever stop it.
            const removed = await runtime.remove(sidecar);
            if (removed) {
              logger.info(
                `${prefix}Removed the bgutil-provider sidecar: ${POT_PROVIDER_OFF}`,
              );
            } else {
              logger.warn(
                `${prefix}Could not remove the bgutil-provider sidecar, which this deployment no longer uses. Remove the container ${sidecar} by hand.`,
              );
            }
          }

          // After the tier is healthy: a converge that failed above left the
          // gateway as it was.
          if (rollsAlwaysRollTier)
            await retireGateway({ dryRun: false, runtime });
        }
      }

      // Whether the gateway an earlier release ran is gone now, which every
      // backend role this deploy starts is told: the step above may just
      // have retired it.
      if (!dryRun && rotatableToUpdate.length > 0)
        serviceConfig.gatewayRetired = await gatewayRetired(runtime);

      // Deploy rotatable services
      if (rotatableToUpdate.length > 0) {
        if (inPlaceUpdate) {
          // In-place update: update services in current color without switching
          if (!currentColor) {
            logger.error('No active deployment found');
            logger.info('Run a full deploy first (without --services)');
            throw new Error('No active deployment for in-place update');
          }

          logger.info(`Updating in current color: ${currentColor}`);

          // Read the running version now (the recreate below replaces the
          // container it lives in); it is recorded as the rollback target only
          // once the update is healthy — see below.
          const currentPlatformVersion = dryRun
            ? null
            : await colorPlatformVersion(currentColor, runtime);

          // Update services in current color
          logger.step(`${prefix}Updating ${currentColor} services...`);
          const colorCompose = generateColorCompose(
            serviceConfig,
            currentColor,
            origin,
          );

          if (dryRun) {
            for (const service of rotatableToUpdate) {
              logger.info(
                `${prefix}Would update ${replicas[service]}× ${service} in ${colorProject(currentColor)}`,
              );
            }
          } else {
            // In place in the LIVE colour: this replaces the containers that
            // are serving, with no colour to fall back to. That is why it is
            // the escape hatch (`--services`) and not the default path — a
            // default deploy always brings a whole new colour up first.
            logger.warn(
              `In-place update of the live ${currentColor} colour: these replicas are replaced while they serve. A default deploy (no --services) rolls a whole colour instead.`,
            );
            const drainLiveApi = rotatableToUpdate.includes(apiService(tier));
            if (drainLiveApi) {
              await drainBackend({
                dryRun: false,
                colour: currentColor,
                runtime,
              });
            }
            try {
              const deployResult = await runtime.converge(
                {
                  stack: colorProject(currentColor),
                  compose: colorCompose,
                  cwd: env.DEPLOY_DIR,
                },
                {
                  services: rotatableToUpdate,
                  scale: replicas,
                  forceRecreate: Boolean(options.forceRecreate),
                },
              );

              if (!deployResult.success) {
                logger.error(`Failed to update ${currentColor} services`);
                logger.error(deployResult.stderr);
                throw new Error('In-place update failed');
              }

              // Wait for services to be healthy
              logger.step('Waiting for services to be healthy...');
              for (const service of rotatableToUpdate) {
                const healthy = await runtime.waitServiceHealthy(
                  colorProject(currentColor),
                  service,
                  {
                    timeout: env.HEALTH_CHECK_TIMEOUT,
                    expectedReplicas: replicas[service],
                    streamLogs,
                  },
                );
                if (!healthy) {
                  throw new Error(
                    `Service ${service} (${currentColor}) failed health check`,
                  );
                }
              }

              // Only now record the replaced version as the rollback target. A
              // deploy that failed its health check above leaves the old
              // version live, and writing early would have overwritten the
              // genuine fallback with the version that is still running
              // (rollback.ts writes previous-version after the flip, too).
              if (currentPlatformVersion) {
                await setPreviousVersion(
                  env.DEPLOY_DIR,
                  currentPlatformVersion,
                );
                logger.info(
                  `Previous version saved: ${currentPlatformVersion}`,
                );
              }
            } finally {
              // Same-colour replacements 503 new turns until this clears.
              if (drainLiveApi) await endDrainBackend(runtime);
            }
          }
        } else {
          // Full blue-green deployment of the WHOLE application tier
          const nextColor = getNextColor(currentColor);

          logger.info(`Current color: ${currentColor ?? 'none'}`);
          logger.info(`Deploying to: ${nextColor}`);
          logger.info(`Replicas: ${describeReplicas(tier, replicas)}`);

          // The running version becomes the rollback target only after the
          // new colour is healthy and traffic has switched (below) — a failed
          // deploy must not overwrite the genuine fallback.
          const currentPlatformVersion =
            currentColor && !dryRun
              ? await colorPlatformVersion(currentColor)
              : null;

          // Deploy new color
          logger.step(`${prefix}Deploying ${nextColor} services...`);

          if (dryRun) {
            for (const service of rotatableToUpdate) {
              logger.info(
                `${prefix}Would deploy ${replicas[service]}× ${service} in ${colorProject(nextColor)}`,
              );
            }
            logger.step(`${prefix}Would switch traffic to ${nextColor}`);
            if (currentColor) {
              logger.step(
                `${prefix}Would drain the ${currentColor} api, wait ${env.DRAIN_TIMEOUT}s for the web tier, detach it from the serving networks, then remove it`,
              );
            }
          } else {
            if (flip === null)
              // Unreachable: every deploy that is no dry run and no update in
              // place planned its flip above. Stated so a colour is never
              // started on a guess.
              throw new Error('The colour flip was not planned');
            const { promoting, retiring } = flip;

            if (!flip.resumed) {
              if ((await getFlipPending(env.DEPLOY_DIR)) !== null)
                await clearFlipPending(env.DEPLOY_DIR);
              await setFlipPending(env.DEPLOY_DIR, {
                promoting,
                retiring,
              });
            } else if (flip.step === 'start') {
              logger.info(
                `Resuming the interrupted flip onto ${promoting}: it serves nothing as it stands, so it is started again.`,
              );
            } else {
              logger.info(
                `Resuming the interrupted flip onto ${promoting} (will not recreate a colour that is already up).`,
              );
            }

            if (cutover !== null) {
              logger.warn(
                cutover.resume
                  ? 'Resuming the automation writer protocol cutover: the old backend stays stopped while the new colour starts.'
                  : `Automation writer protocol cutover (once): the ${legacyVersion ?? 'old'} backend stops now, before ${version} starts, so the API is unavailable until the new colour is healthy. Its first start applies every database migration since v0.5.77; if that outlasts HEALTH_CHECK_TIMEOUT (${env.HEALTH_CHECK_TIMEOUT}s), run \`tale deploy\` again to keep waiting.`,
              );
              await runTagAutomationCutover({
                project: getProjectId(),
                registry: env.GHCR_REGISTRY,
                deployDir: env.DEPLOY_DIR,
                plan: cutover,
                release: version,
              });
            }

            if (flip.step !== 'start') {
              if (flip.runsInstead !== null)
                // It holds the traffic, so it is not touched: what this run
                // asks for beyond it is the next deploy's, with a flip of
                // its own.
                logger.warn(
                  `The ${promoting} colour already holds the traffic and runs ${flip.runsInstead}, where this deploy asks for ${describeReplicas(tier, replicas)}. It is left as it is while the interrupted flip finishes. Run \`tale deploy\` again to apply the difference.`,
                );
              // Resuming onto a colour that is already up: a deploy that
              // timed out waiting for it may have left it still migrating.
              // It takes traffic only once every replica is healthy.
              await awaitRunningColorHealthy({
                color: promoting,
                services: flip.services,
                replicas: flip.replicas,
                healthTimeout: env.HEALTH_CHECK_TIMEOUT,
                streamLogs,
                runtime,
              });
            } else {
              // Registered BEFORE the bring-up, not after: the health wait is
              // the longest part of a deploy and the likeliest moment for a
              // Ctrl-C, and a colour interrupted mid-start has taken no
              // traffic — it must be torn down rather than left half-running.
              startedColorProjects.push(colorProject(promoting));
              await startColor({
                color: promoting,
                services: rotatableToUpdate,
                compose: generateColorCompose(serviceConfig, promoting, origin),
                replicas,
                cwd: env.DEPLOY_DIR,
                healthTimeout: env.HEALTH_CHECK_TIMEOUT,
                forceRecreate: options.forceRecreate ?? false,
                streamLogs,
                runtime,
              });
            }

            // Switch traffic — clear tracking first so an interrupt during
            // the async write won't kill live containers.
            startedColorProjects.length = 0;

            // Sweep the pre-upgrade singleton BEFORE the long colour drain.
            // Left running it writes `convex-data` while the new colour
            // writes `config-data`, and it is the wrong door for beginDrain.
            await retireLegacyBackendTier(runtime);

            logger.step(`Switching traffic to ${promoting}...`);
            await runtime.admit(colorProject(promoting), flip.services);
            await setCurrentColor(env.DEPLOY_DIR, promoting);
            if (currentPlatformVersion) {
              await setPreviousVersion(env.DEPLOY_DIR, currentPlatformVersion);
              logger.info(`Previous version saved: ${currentPlatformVersion}`);
            }

            if (retiring) {
              await retireColor({
                color: retiring,
                drainTimeout: env.DRAIN_TIMEOUT,
                runtime,
              });
            }

            await clearFlipPending(env.DEPLOY_DIR);
          }
        }
      }

      await finish();
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
}

async function syncProjectFiles(
  containerName: string | null,
  projectDir: string,
  dryRun: boolean,
  prefix: string,
  tempStageDirs: Set<string>,
  override: boolean,
  runtime: StackRuntime,
): Promise<void> {
  // Default deploy never pushes host config: the container self-seeds builtin
  // defaults on first start and UI edits stay authoritative. Host config is
  // pushed only when the operator explicitly asks via `--override`.
  if (!override) {
    logger.blank();
    logger.info(
      `${prefix}Config files not pushed (container keeps its current config).`,
    );
    logger.info(
      `${prefix}  Re-run with --override to overwrite container config from the host workspace.`,
    );
    return;
  }

  const { orgs, staleRootOrgDirs } = discoverOrgs(projectDir);

  if (staleRootOrgDirs.length > 0) {
    // Pre-`.tale/orgs/` layout: orgs used to sit at the project root. They are
    // no longer pushed from there — real orgs live under `.tale/orgs/<slug>/`.
    logger.warn(
      `${prefix}Found org-shaped ${staleRootOrgDirs.length === 1 ? 'directory' : 'directories'} at the project root (${staleRootOrgDirs.join(', ')}/). ` +
        `Real organizations now live under .tale/orgs/<slug>/ and these will NOT be pushed. ` +
        `Move them under .tale/orgs/ to deploy them.`,
    );
  }

  if (orgs.length === 0) {
    logger.blank();
    logger.info(
      `${prefix}Nothing to push: no organizations found under .tale/orgs/. ` +
        `Real orgs are created in-app; the container self-seeds from the builtin catalog.`,
    );
    return;
  }

  if (!dryRun && containerName === null) {
    logger.warn(
      `${prefix}No backend-api replica is running, skipping file sync`,
    );
    return;
  }
  if (!dryRun && containerName !== null) {
    const running = await runtime.isRunning(containerName);
    if (!running) {
      logger.warn(
        `${prefix}Container ${containerName} is not running, skipping file sync`,
      );
      return;
    }
  }

  logger.blank();
  logger.step(
    `${prefix}Overriding container config from host workspace (1:1 push)...`,
  );
  logger.info(
    `${prefix}  (encrypted *.secrets.json and .history/ are always preserved)`,
  );
  logger.info(
    `${prefix}  (--override is an additive overlay; files deleted locally remain in the container — use --override-all to factory-reseed from builtin)`,
  );

  // Stage the full set of org subtrees into a single tmp dir whose top-level
  // mirrors the in-container `/app/data/` shape: `<stage>/<org>/<domain>/...`.
  // Then a single copy of `<stage>/.` into `<container>:/app/data/` does the
  // push (`docker cp` on Docker).
  // Root-level junk (`tale.json`, `.tale/`, `.env`, `.git/`, IDE configs, etc.)
  // is excluded by allowlist — never staged, never shipped.
  const stageDir = await mkdtemp(join(tmpdir(), 'tale-sync-'));
  tempStageDirs.add(stageDir);

  try {
    for (const org of orgs) {
      const orgDst = join(stageDir, org.slug);

      if (dryRun) {
        logger.info(
          `${prefix}Would push .tale/orgs/${org.slug}/ → ${containerName ?? BACKEND_API_LABEL}:/app/data/${org.slug}/ (excluding *.secrets.json, .history/, symlinks)`,
        );
        continue;
      }

      await stageOrgIntoDir(org.srcDir, orgDst);
    }

    if (dryRun) {
      logger.info(
        `${prefix}Skipped: the default/ template, tale.json, .env, .git/, dotfiles, any non-org entries`,
      );
      return;
    }
    if (containerName === null) {
      // Unreachable: a non-dry run without a replica returned at the guard
      // above, and every dry run has returned by here. Stated so the push
      // below cannot silently address a missing container.
      throw new Error('No backend-api replica to push the config into');
    }

    // The copy lands as root; ownership goes to the app user so it can write.
    const pushed = await runtime.copyIn(containerName, stageDir, '/app/data/', {
      user: 'app',
      group: 'app',
    });

    // docker cp is non-atomic across the multi-org staging dir: a failure
    // here means a partial push may have landed in the container. Throw
    // so the outer `deployToContainer` flow exits non-zero instead of
    // printing `success('Deployment complete!')` over a half-pushed state.
    if (!pushed.success && pushed.stage === 'copy') {
      throw new Error(
        `--override docker cp into ${containerName} failed: ${pushed.detail}. ` +
          `Partial push possible; re-run --override after addressing the cause.`,
      );
    }
    if (!pushed.success) {
      // Hard fail: files landed but the app user can't write them.
      // Printing `Overrode N orgs!` while the volume is root-owned
      // sent operators into a debugging maze when later writes failed
      // silently inside the container. The push is recoverable — they
      // can re-run --override after fixing the cause — but a quiet
      // wrong-perms state is not.
      throw new Error(
        `Failed to fix ownership on /app/data after push: ${pushed.detail}. ` +
          `The push completed but files are root-owned and the app user can't write to them. ` +
          `Re-run --override after addressing the cause.`,
      );
    }

    logger.success(
      `Overrode ${orgs.length} org${orgs.length === 1 ? '' : 's'}: ${orgs.map((o) => o.slug).join(', ')}`,
    );
  } finally {
    tempStageDirs.delete(stageDir);
    await rm(stageDir, { recursive: true, force: true });
  }
}

// Copy a host org subtree (`<projectDir>/<orgName>/`) into a fresh
// `<stageDir>/<orgName>/` while:
//   - skipping `.history/` directories at any depth (UI edit-history trail
//     must survive in the container; `docker cp` is additive so absent =
//     preserved on the container side),
//   - skipping `*.secrets.json` files at any depth (encrypted secrets
//     cannot be re-derived from the host),
//   - skipping symlinks (defense against operator's host workspace
//     containing a symlink to /etc/passwd or similar; cp's filter receives
//     the source path so we lstat it).
//
// All directory exclusions prune the entire subtree; `fs.cp` recurses past
// the filter for any directory the filter returned `true` for. Root-level
// non-org junk is excluded one level up, BUT the same kinds of junk can
// also appear INSIDE an org dir (e.g. operator commits their workspace as
// a git repo → `default/.git/`; macOS sprinkles `default/.DS_Store`;
// someone runs `npm i` in their providers folder → `default/node_modules/`).
// Filter them here so they never reach `/app/data/<org>/`.
const STAGED_DOTFILE_DENYLIST = new Set<string>([
  // Belt-and-suspenders for things we already filter via startsWith('.'),
  // but listing them makes intent explicit.
  '.git',
  '.tale',
  '.vscode',
  '.idea',
  '.DS_Store',
]);
const STAGED_NAME_DENYLIST = new Set<string>(['node_modules', '__pycache__']);
async function stageOrgIntoDir(srcDir: string, destDir: string): Promise<void> {
  await cp(srcDir, destDir, {
    recursive: true,
    filter: (src) => {
      const base = src.split(/[\\/]/).pop() ?? '';
      // `.history` and `*.secrets.json` are content-preserving filters by
      // design — survive overwrites on the server side, so we never push
      // them. Dotfiles (including `.git/`, `.DS_Store`, editor swap files,
      // etc.) are operator-host junk that should never reach the data
      // tree. node_modules / __pycache__ catch any non-dotfile package-mgr
      // litter inside an org dir.
      if (base === '.history') return false;
      if (base.endsWith('.secrets.json')) return false;
      if (base.startsWith('.')) return false;
      if (STAGED_DOTFILE_DENYLIST.has(base)) return false;
      if (STAGED_NAME_DENYLIST.has(base)) return false;
      // lstat is sync here because fs.cp's filter is sync. Symlinks at
      // any depth are skipped; missing entries (ENOENT) also skip rather
      // than throw — fs.cp re-races stat() so any race is benign.
      try {
        const info = lstatSync(src);
        if (info.isSymbolicLink()) return false;
      } catch (err: unknown) {
        // ENOENT on a sibling stat is benign; anything else is worth a
        // warning so a real permission/IO problem doesn't silently drop
        // a file.
        const code =
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          typeof err.code === 'string'
            ? err.code
            : undefined;
        if (code !== 'ENOENT') {
          logger.warn(
            `stageOrgIntoDir: lstat ${src} failed (${code ?? 'unknown'}); skipping`,
          );
        }
        return false;
      }
      return true;
    },
  });
}
