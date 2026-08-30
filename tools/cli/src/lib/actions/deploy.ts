import { lstatSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { runStepsInParallel } from '../../utils/progress';
import { createSnapshot } from '../backup/create-snapshot';
import { rotateSnapshots } from '../backup/rotate-snapshots';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { generateStatefulCompose } from '../compose/generators/generate-stateful-compose';
import { selectDefaultServices } from '../compose/select-services';
import {
  type RotatableService,
  type ServiceName,
  type StatefulService,
  type StopGatedService,
  STOP_GATED_SERVICES,
  isRotatableService,
  isStatefulService,
} from '../compose/types';
import { dockerCompose } from '../docker/docker-compose';
import { ensureNetwork, ensureSandboxNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { getContainerVersion } from '../docker/get-container-version';
import { isContainerRunning } from '../docker/is-container-running';
import { pullImage } from '../docker/pull-image';
import { removeContainer } from '../docker/remove-container';
import { stopContainer } from '../docker/stop-container';
import { waitForHealthy } from '../docker/wait-for-healthy';
import { discoverOrgs } from '../project/org-dirs';
import { getCurrentColor } from '../state/get-current-color';
import { getNextColor } from '../state/get-next-color';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';
import {
  backendApiContainer,
  drainBackend,
  endDrainBackend,
} from './drain-backend';
import { drainSandbox } from './drain-sandbox';
import { reseedAllOrgsFromBuiltin } from './reseed-all-orgs';

async function ensureInfrastructure(
  prefix: string,
  dryRun: boolean,
): Promise<void> {
  logger.step(`${prefix}Ensuring volumes and network exist...`);
  if (dryRun) {
    for (const vol of REQUIRED_VOLUMES) {
      logger.info(`${prefix}Would ensure volume: ${getProjectId()}_${vol}`);
    }
    logger.info(`${prefix}Would ensure network: ${getProjectId()}_internal`);
    return;
  }

  const volumesCreated = await ensureVolumes([...REQUIRED_VOLUMES]);
  if (!volumesCreated) {
    throw new Error('Failed to create required volumes');
  }
  const networkCreated = await ensureNetwork('internal');
  if (!networkCreated) {
    throw new Error('Failed to create required network');
  }
  // Sandbox bridge: fixed name `tale-sandbox-net`, internal-only, IPv6 off.
  const sandboxNetworkCreated = await ensureSandboxNetwork();
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
  dryRun: boolean;
  services?: ServiceName[];
  override?: boolean;
  /**
   * Factory-reseed builtin → all orgs after deploy completes. Triggers a
   * server-side reseed action; preserves *.secrets.json, .history/, and
   * uploaded branding/images/. Combined with `override`, host-push runs
   * first, then the all-orgs reseed.
   */
  overrideAll?: boolean;
  quiet?: boolean;
  /** Non-interactive: accept destructive confirmation prompts (e.g. --override-all). */
  assumeYes?: boolean;
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
}

export async function deploy(options: DeployOptions): Promise<void> {
  const { version, stop, env, hostAlias, dryRun, services } = options;
  const streamLogs = !options.quiet && (process.stdout.isTTY ?? false);

  // Track containers started during this deploy for cleanup on interrupt
  const startedContainers: string[] = [];
  // Track tmp staging dirs created by syncProjectFiles so interrupts don't leak /tmp/tale-sync-*
  const tempStageDirs = new Set<string>();
  let interrupted = false;

  const onInterrupt = () => {
    if (interrupted) return;
    interrupted = true;
    logger.blank();
    logger.warn('Deployment interrupted, cleaning up started containers...');
    for (const name of startedContainers) {
      try {
        Bun.spawnSync(['docker', 'stop', '-t', '2', name]);
        Bun.spawnSync(['docker', 'rm', '-f', name]);
        logger.info(`Stopped ${name}`);
      } catch (err) {
        // Best-effort cleanup: log so an operator can follow up manually.
        logger.warn(
          `Failed to clean up ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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
    await withLock(env.DEPLOY_DIR, `deploy ${version}`, async () => {
      const prefix = dryRun ? '[DRY-RUN] ' : '';
      logger.header(`${prefix}Deploying Tale ${version}`);

      // Check if this is a first-time deployment
      const currentColor = await getCurrentColor(env.DEPLOY_DIR);
      const isFirstDeploy = currentColor === null;

      // Pre-mutation volume snapshot — the recovery point for forward-only
      // migrations. Taken whenever this deploy can change data: a version
      // change (new images run implicit migrations on first boot) or a
      // host-config push. First deploys have nothing to snapshot yet;
      // snapshot failure aborts the deploy unless the operator opted out
      // via --skip-backup.
      if (!isFirstDeploy) {
        const snapshotPrefix = `${getProjectId()}_`;
        const runningVersion = await getContainerVersion(
          `${getProjectId()}-platform-${currentColor}`,
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
            });
            await rotateSnapshots({ prefix: snapshotPrefix });
          }
        }
      }

      // Determine which services to deploy
      let rotatableToUpdate: RotatableService[];
      let statefulToUpdate: StatefulService[];

      if (services && services.length > 0) {
        // User specified explicit services
        rotatableToUpdate = services.filter(isRotatableService);
        statefulToUpdate = services.filter(isStatefulService);
      } else {
        // Default deploy uses the three-tier policy (see select-services.ts):
        // rotatable (platform) blue-green; the always-roll tier (convex,
        // sandbox-llm-gateway, sandbox, sandbox-egress) rolls in-place via the
        // stateful compose (sandbox drained first via /v1/drain); stop-gated
        // (db, proxy) only when stopped / first deploy / --stop, else left
        // running with a hint.
        const runningState = new Map<StopGatedService, boolean>();
        for (const service of STOP_GATED_SERVICES) {
          runningState.set(
            service,
            await isContainerRunning(`${getProjectId()}-${service}`),
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
        `Rotatable services: ${rotatableToUpdate.join(', ') || 'none'}`,
      );
      logger.info(
        `Stateful services: ${statefulToUpdate.join(', ') || 'none'}`,
      );

      const serviceConfig = {
        version,
        registry: env.GHCR_REGISTRY,
      };

      // Pull all required images first. The sandbox tier (sandbox +
      // sandbox-egress) is now a stateful always-roll singleton, so its images
      // are pulled here via statefulToUpdate like convex — no special-casing.
      logger.step(`${prefix}Pulling images...`);
      const imagesToPull = [
        ...rotatableToUpdate.map(
          (s) => `${env.GHCR_REGISTRY}/tale-${s}:${version}`,
        ),
        ...statefulToUpdate.map(
          (s) => `${env.GHCR_REGISTRY}/tale-${s}:${version}`,
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

      if (dryRun) {
        for (const image of imagesToPull) {
          logger.info(`${prefix}Would pull: ${image}`);
        }
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
              if (!(await pullImage(image))) {
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
          throw new Error(
            `Failed to pull ${failedImages.length} image(s): ${failedImages.join(', ')}\n` +
              'If this is a recent release, the container images may still be building and testing. ' +
              'Please wait a few minutes and try again.',
          );
        }
        if (runtimeImageRemote) {
          const tagResult = await exec('docker', [
            'tag',
            runtimeImageRemote,
            'tale-sandbox-runtime:latest',
          ]);
          if (!tagResult.success) {
            throw new Error(
              `Failed to re-tag sandbox runtime image: ${tagResult.stderr.trim()}`,
            );
          }
        }
        if (buildkitdImageRemote) {
          const tagResult = await exec('docker', [
            'tag',
            buildkitdImageRemote,
            'tale-sandbox-buildkitd:latest',
          ]);
          if (!tagResult.success) {
            throw new Error(
              `Failed to re-tag sandbox buildkitd image: ${tagResult.stderr.trim()}`,
            );
          }
        }
      }

      // Must run AFTER migrations (which may `docker compose down`, removing
      // networks) and BEFORE any `docker compose up` for stateful or rotatable
      // services.
      await ensureInfrastructure(prefix, dryRun);

      // Deploy stateful services if any
      if (statefulToUpdate.length > 0) {
        logger.step(`${prefix}Deploying stateful services...`);
        const statefulCompose = generateStatefulCompose(
          serviceConfig,
          hostAlias,
        );

        // The opt-in controller sidecar is emitted into the stateful compose
        // only when CONTROLLER_TOKEN is set. It is brought up SEPARATELY from the
        // core services (below) so a controller image/start problem can never
        // block db/proxy/backend.
        const controllerEnabled = Boolean(process.env.CONTROLLER_TOKEN);

        // Will this deploy actually recreate the backend? `docker compose up
        // -d` is a no-op when the image + config are unchanged, so only drain
        // in-flight turns when its image version is changing (or a forced
        // recreate) — draining a no-op deploy would refuse chats for nothing.
        // It ships the platform image, so a version change recreates it and
        // cuts the turns its api container is streaming.
        const backendWillRecreate =
          !isFirstDeploy &&
          statefulToUpdate.includes('backend-api') &&
          (Boolean(options.forceRecreate) ||
            (await getContainerVersion(backendApiContainer())) !== version);

        // Will this deploy actually recreate the sandbox spawner? Same logic as
        // convex: drain in-flight one-shot executions only when the single
        // sandbox container's image version is changing (or a forced recreate),
        // so a no-op deploy doesn't refuse executions for nothing.
        const sandboxWillRecreate =
          !isFirstDeploy &&
          statefulToUpdate.includes('sandbox') &&
          (Boolean(options.forceRecreate) ||
            (await getContainerVersion(`${getProjectId()}-sandbox`)) !==
              version);

        if (dryRun) {
          if (backendWillRecreate) {
            await drainBackend({ dryRun: true });
          }
          if (sandboxWillRecreate) {
            await drainSandbox({ dryRun: true });
          }
          for (const service of statefulToUpdate) {
            logger.info(`${prefix}Would deploy stateful service: ${service}`);
          }
          if (controllerEnabled) {
            logger.info(
              `${prefix}Would deploy controller sidecar (separate, non-blocking)`,
            );
          }
          logger.info(
            `${prefix}Would deploy bgutil-provider sidecar (separate, non-blocking)`,
          );
        } else {
          // Drain in-flight chat generations before the in-place recreate
          // kills them. Best-effort (see drain-backend.ts); the recovery
          // watchdog finalizes anything that outlasts the drain budget.
          if (backendWillRecreate) {
            await drainBackend({ dryRun: false });
          }

          // Drain in-flight sandbox executions before the single spawner is
          // recreated below (the tier dropped blue-green — one container rolled
          // in place). Best-effort (see drain-sandbox.ts); the spawner's SIGTERM
          // drain + stop_grace_period backstops anything that outlasts the
          // budget.
          if (sandboxWillRecreate) {
            await drainSandbox({ dryRun: false });
          }

          const result = await dockerCompose(
            statefulCompose,
            [
              'up',
              '-d',
              ...(options.forceRecreate ? ['--force-recreate'] : []),
              ...statefulToUpdate,
            ],
            { projectName: getProjectId(), cwd: env.DEPLOY_DIR },
          );

          if (!result.success) {
            logger.error('Failed to deploy stateful services');
            logger.error(result.stderr);
            throw new Error(
              `Stateful deployment failed: ${result.stderr.trim().slice(0, 500) || 'no stderr captured'}`,
            );
          }

          for (const service of statefulToUpdate) {
            startedContainers.push(`${getProjectId()}-${service}`);
          }

          // Wait for stateful services to be healthy
          for (const service of statefulToUpdate) {
            const containerName = `${getProjectId()}-${service}`;
            const healthy = await waitForHealthy(containerName, {
              timeout: env.HEALTH_CHECK_TIMEOUT,
              streamLogs,
            });
            if (!healthy) {
              throw new Error(`Service ${service} failed health check`);
            }
          }

          // The backend is back and healthy — lift the drain flag so new
          // turns are accepted again. Best-effort; its auto-expiry clears the
          // flag anyway if this fails (see drain-backend.ts).
          if (backendWillRecreate) {
            await endDrainBackend();
          }

          // The controller is a non-critical opt-in sidecar. Bring it up in its
          // OWN `up -d` only after the core services are healthy, and treat any
          // failure (e.g. the image isn't published/pulled yet) as a warning —
          // never fail the deploy of the core services over it.
          if (controllerEnabled) {
            const up = await dockerCompose(
              statefulCompose,
              [
                'up',
                '-d',
                ...(options.forceRecreate ? ['--force-recreate'] : []),
                'controller',
              ],
              { projectName: getProjectId(), cwd: env.DEPLOY_DIR },
            );
            if (!up.success) {
              logger.warn(
                `${prefix}Controller sidecar did not start (one-click "Apply & restart" may be unavailable): ${up.stderr.trim().slice(0, 300) || 'no stderr captured'}`,
              );
            } else {
              startedContainers.push(`${getProjectId()}-controller`);
              const containerName = `${getProjectId()}-controller`;
              const healthy = await waitForHealthy(containerName, {
                timeout: env.HEALTH_CHECK_TIMEOUT,
                streamLogs,
              });
              if (!healthy) {
                logger.warn(
                  `${prefix}Controller sidecar did not become healthy; one-click "Apply & restart" may be unavailable until it recovers.`,
                );
              }
            }
          }

          // bgutil PO-token provider — brought up SEPARATELY and best-effort,
          // like the controller above. It's a third-party image (not a
          // `tale-*` build in the always-roll tier), so a pull/start failure
          // must never fail the core deploy, and YouTube ingestion degrades
          // gracefully (no PO token) if it never starts. Always attempted —
          // it's the zero-config path, not opt-in.
          const bgutilUp = await dockerCompose(
            statefulCompose,
            [
              'up',
              '-d',
              ...(options.forceRecreate ? ['--force-recreate'] : []),
              'bgutil-provider',
            ],
            { projectName: getProjectId(), cwd: env.DEPLOY_DIR },
          );
          if (!bgutilUp.success) {
            logger.warn(
              `${prefix}bgutil-provider sidecar did not start (YouTube ingestion falls back to no PO token): ${bgutilUp.stderr.trim().slice(0, 300) || 'no stderr captured'}`,
            );
          } else {
            startedContainers.push(`${getProjectId()}-bgutil-provider`);
          }
        }
      }

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

          // Save current version as previous (for rollback)
          if (!dryRun) {
            const currentPlatformVersion = await getContainerVersion(
              `${getProjectId()}-platform-${currentColor}`,
            );
            if (currentPlatformVersion) {
              await setPreviousVersion(env.DEPLOY_DIR, currentPlatformVersion);
              logger.info(`Previous version saved: ${currentPlatformVersion}`);
            }
          }

          // Update services in current color
          logger.step(`${prefix}Updating ${currentColor} services...`);
          const colorCompose = generateColorCompose(
            serviceConfig,
            currentColor,
          );

          if (dryRun) {
            for (const service of rotatableToUpdate) {
              logger.info(
                `${prefix}Would update: ${getProjectId()}-${service}-${currentColor}`,
              );
            }
          } else {
            const coloredServices = rotatableToUpdate.map(
              (s) => `${s}-${currentColor}`,
            );
            const deployResult = await dockerCompose(
              colorCompose,
              [
                'up',
                '-d',
                ...(options.forceRecreate ? ['--force-recreate'] : []),
                ...coloredServices,
              ],
              {
                projectName: `${getProjectId()}-${currentColor}`,
                cwd: env.DEPLOY_DIR,
              },
            );

            for (const service of rotatableToUpdate) {
              startedContainers.push(
                `${getProjectId()}-${service}-${currentColor}`,
              );
            }

            if (!deployResult.success) {
              logger.error(`Failed to update ${currentColor} services`);
              logger.error(deployResult.stderr);
              throw new Error('In-place update failed');
            }

            // Wait for services to be healthy
            logger.step('Waiting for services to be healthy...');
            for (const service of rotatableToUpdate) {
              const containerName = `${getProjectId()}-${service}-${currentColor}`;
              const healthy = await waitForHealthy(containerName, {
                timeout: env.HEALTH_CHECK_TIMEOUT,
                streamLogs,
              });
              if (!healthy) {
                throw new Error(
                  `Service ${service}-${currentColor} failed health check`,
                );
              }
            }

            // In-place update succeeded — don't tear down on interrupt
            startedContainers.length = 0;
          }
        } else {
          // Full blue-green deployment
          const nextColor = getNextColor(currentColor);

          logger.info(`Current color: ${currentColor ?? 'none'}`);
          logger.info(`Deploying to: ${nextColor}`);

          // Save current version as previous (for rollback)
          if (currentColor && !dryRun) {
            const currentPlatformVersion = await getContainerVersion(
              `${getProjectId()}-platform-${currentColor}`,
            );
            if (currentPlatformVersion) {
              await setPreviousVersion(env.DEPLOY_DIR, currentPlatformVersion);
              logger.info(`Previous version saved: ${currentPlatformVersion}`);
            }
          }

          // Deploy new color
          logger.step(`${prefix}Deploying ${nextColor} services...`);
          const colorCompose = generateColorCompose(serviceConfig, nextColor);

          if (dryRun) {
            for (const service of rotatableToUpdate) {
              logger.info(
                `${prefix}Would clean up stale: ${getProjectId()}-${service}-${nextColor}`,
              );
              logger.info(
                `${prefix}Would deploy: ${getProjectId()}-${service}-${nextColor}`,
              );
            }
            logger.step(`${prefix}Would switch traffic to ${nextColor}`);
            if (currentColor) {
              logger.step(
                `${prefix}Would drain ${currentColor} services (${env.DRAIN_TIMEOUT}s)`,
              );
              for (const service of rotatableToUpdate) {
                logger.info(
                  `${prefix}Would stop/remove: ${getProjectId()}-${service}-${currentColor}`,
                );
              }
            }
          } else {
            // Clean up any stale next-color containers from a previous failed deployment
            for (const service of rotatableToUpdate) {
              const containerName = `${getProjectId()}-${service}-${nextColor}`;
              const stopped = await stopContainer(containerName);
              if (stopped) {
                await removeContainer(containerName);
              }
            }
            logger.step(`Starting ${nextColor} services...`);
            const coloredServices = rotatableToUpdate.map(
              (s) => `${s}-${nextColor}`,
            );
            const deployResult = await dockerCompose(
              colorCompose,
              [
                'up',
                '-d',
                ...(options.forceRecreate ? ['--force-recreate'] : []),
                ...coloredServices,
              ],
              {
                projectName: `${getProjectId()}-${nextColor}`,
                cwd: env.DEPLOY_DIR,
              },
            );

            for (const service of rotatableToUpdate) {
              startedContainers.push(
                `${getProjectId()}-${service}-${nextColor}`,
              );
            }

            if (!deployResult.success) {
              logger.error(`Failed to deploy ${nextColor} services`);
              logger.error(deployResult.stderr);
              throw new Error('Color deployment failed');
            }

            // Wait for new services to be healthy
            logger.step('Waiting for services to be healthy...');
            for (const service of rotatableToUpdate) {
              const containerName = `${getProjectId()}-${service}-${nextColor}`;
              const healthy = await waitForHealthy(containerName, {
                timeout: env.HEALTH_CHECK_TIMEOUT,
                streamLogs,
              });
              if (!healthy) {
                throw new Error(
                  `Service ${service}-${nextColor} failed health check`,
                );
              }
            }

            // Switch traffic to new color — clear tracking first so an
            // interrupt during the async write won't kill live containers.
            startedContainers.length = 0;
            logger.step(`Switching traffic to ${nextColor}...`);
            await setCurrentColor(env.DEPLOY_DIR, nextColor);

            // Drain old color (if exists)
            if (currentColor) {
              // Pre-mark the old platform colour as shutting down BEFORE the
              // drain sleep. Its /api/health then returns 503, so the proxy
              // ejects it and routes NEW requests only to the new colour while
              // in-flight requests finish during the window. Without this, both
              // colours keep the `platform` alias for the whole sleep and
              // traffic is split across two versions. Best-effort + platform-
              // specific (the marker lives in the platform entrypoint); a
              // failure just falls back to the graceful stop below.
              for (const service of rotatableToUpdate) {
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
              logger.step(
                `Draining ${currentColor} services (${env.DRAIN_TIMEOUT}s)...`,
              );
              await Bun.sleep(env.DRAIN_TIMEOUT * 1000);

              // Stop and remove old color containers (non-fatal - traffic already switched)
              logger.step(`Stopping ${currentColor} services...`);
              for (const service of rotatableToUpdate) {
                const containerName = `${getProjectId()}-${service}-${currentColor}`;
                const stopped = await stopContainer(containerName);
                if (!stopped) {
                  logger.warn(`Failed to stop ${containerName}, continuing...`);
                }
                const removed = await removeContainer(containerName);
                if (!removed) {
                  logger.warn(
                    `Failed to remove ${containerName}, continuing...`,
                  );
                }
              }
            }
          }
        }
      }

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

      // Sync project files to the convex container (owns convex-data volume rw)
      await syncProjectFiles(
        `${getProjectId()}-convex`,
        env.DEPLOY_DIR,
        dryRun,
        prefix,
        tempStageDirs,
        options.override ?? false,
      );

      // After deploy + optional host-push, trigger server-side reseed of
      // builtin catalog into every org. Runs against the platform container
      // (which holds the convex function source + admin key derivation).
      if (options.overrideAll) {
        await reseedAllOrgsFromBuiltin({
          dryRun,
          assumeYes: options.assumeYes ?? false,
        });
      }

      if (!dryRun) {
        logger.success(`Deployment complete! Version ${version} is now live`);
      }
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
}

async function syncProjectFiles(
  containerName: string,
  projectDir: string,
  dryRun: boolean,
  prefix: string,
  tempStageDirs: Set<string>,
  override: boolean,
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

  if (!dryRun) {
    const running = await isContainerRunning(containerName);
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
  // Then a single `docker cp <stage>/. <container>:/app/data/` does the push.
  // Root-level junk (`tale.json`, `.tale/`, `.env`, `.git/`, IDE configs, etc.)
  // is excluded by allowlist — never staged, never shipped.
  const stageDir = await mkdtemp(join(tmpdir(), 'tale-sync-'));
  tempStageDirs.add(stageDir);

  try {
    for (const org of orgs) {
      const orgDst = join(stageDir, org.slug);

      if (dryRun) {
        logger.info(
          `${prefix}Would push .tale/orgs/${org.slug}/ → ${containerName}:/app/data/${org.slug}/ (excluding *.secrets.json, .history/, symlinks)`,
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

    const dockerSrcPath = stageDir.replaceAll('\\', '/');
    const result = await exec('docker', [
      'cp',
      `${dockerSrcPath}/.`,
      `${containerName}:/app/data/`,
    ]);

    // docker cp is non-atomic across the multi-org staging dir: a failure
    // here means a partial push may have landed in the container. Throw
    // so the outer `deployToContainer` flow exits non-zero instead of
    // printing `success('Deployment complete!')` over a half-pushed state.
    if (!result.success) {
      throw new Error(
        `--override docker cp into ${containerName} failed: ${result.stderr?.trim() ?? '(no stderr)'}. ` +
          `Partial push possible; re-run --override after addressing the cause.`,
      );
    }

    // docker cp copies files as root — fix ownership so the app user can write
    const chownResult = await exec('docker', [
      'exec',
      containerName,
      'chown',
      '-R',
      'app:app',
      `/app/data/`,
    ]);
    if (!chownResult.success) {
      // Hard fail: files landed but the app user can't write them.
      // Printing `Overrode N orgs!` while the volume is root-owned
      // sent operators into a debugging maze when later writes failed
      // silently inside the container. The push is recoverable — they
      // can re-run --override after fixing the cause — but a quiet
      // wrong-perms state is not.
      throw new Error(
        `Failed to fix ownership on /app/data after push: ${chownResult.stderr?.trim() ?? '(no stderr)'}. ` +
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
