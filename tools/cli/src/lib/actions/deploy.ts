import { lstatSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { generateStatefulCompose } from '../compose/generators/generate-stateful-compose';
import {
  type RotatableService,
  type ServiceName,
  type StatefulService,
  LOCKSTEP_SERVICES,
  ROTATABLE_SERVICES,
  STATEFUL_SERVICES,
  isLockstepService,
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
import { getCurrentColor } from '../state/get-current-color';
import { getNextColor } from '../state/get-next-color';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';
import { legacyLayoutPreflight } from './legacy-layout-preflight';
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
  updateStateful: boolean;
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
}

export async function deploy(options: DeployOptions): Promise<void> {
  const { version, updateStateful, env, hostAlias, dryRun, services } = options;
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

      // Detect-and-migrate on legacy flat layout. Only gates host
      // pushes (`--override` / `--override-all`) — a plain container-
      // rotation deploy has no host-config dependency. The preflight
      // prompts (default-No) and runs `migrateConfigLayout` in place
      // on accept; CI / `--yes` migrates without prompting. Replaces
      // the prior hard-fail-with-runbook flow so legacy projects can
      // be upgraded in one command.
      if (options.override || options.overrideAll) {
        await legacyLayoutPreflight({
          projectDir: env.DEPLOY_DIR,
          assumeYes: options.assumeYes ?? false,
          context: 'deploy',
        });
      }

      // Check if this is a first-time deployment
      const currentColor = await getCurrentColor(env.DEPLOY_DIR);
      const isFirstDeploy = currentColor === null;

      // Determine which services to deploy
      let rotatableToUpdate: RotatableService[];
      let statefulToUpdate: StatefulService[];

      if (services && services.length > 0) {
        // User specified explicit services
        rotatableToUpdate = services.filter(isRotatableService);
        statefulToUpdate = services.filter(isStatefulService);
      } else {
        // Default: all rotatable services PLUS lockstep services.
        //
        // Lockstep services (sandbox, sandbox-egress) version in step with
        // the platform image — shipping an old sandbox against new
        // platform code would break the SSE wire contract. Including
        // them on every default deploy matches the build matrix's
        // single-version policy and avoids the "platform upgraded but
        // sandbox stayed on yesterday's image" failure mode that drove
        // the sandbox-wobbly-origami plan §5 rollout decision.
        rotatableToUpdate = [...ROTATABLE_SERVICES];

        if (isFirstDeploy || updateStateful) {
          statefulToUpdate = [...STATEFUL_SERVICES];
          if (isFirstDeploy) {
            logger.notice(
              'First deployment detected - including infrastructure services',
            );
          }
        } else {
          // Check if any required stateful services are not running, and
          // ALWAYS include lockstep services so they roll forward with
          // the platform image.
          const missingStateful: StatefulService[] = [];
          for (const service of STATEFUL_SERVICES) {
            if (isLockstepService(service)) continue; // handled below
            const containerName = `${getProjectId()}-${service}`;
            const running = await isContainerRunning(containerName);
            if (!running) {
              missingStateful.push(service);
            }
          }

          const lockstepToUpdate: StatefulService[] = [...LOCKSTEP_SERVICES];

          if (missingStateful.length > 0) {
            logger.notice(
              `Infrastructure services not running: ${missingStateful.join(', ')} - including automatically`,
            );
          }
          if (lockstepToUpdate.length > 0) {
            logger.info(
              `Lockstep services: ${lockstepToUpdate.join(', ')} - included on every default deploy`,
            );
          }
          statefulToUpdate = [...missingStateful, ...lockstepToUpdate];
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

      // Pull all required images first
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
      // re-tag step. Pulled whenever sandbox or sandbox-egress is being
      // updated, since the runtime image versions in lockstep with the spawner.
      const needsRuntimeImage =
        statefulToUpdate.includes('sandbox') ||
        statefulToUpdate.includes('sandbox-egress');
      const runtimeImageRemote = needsRuntimeImage
        ? `${env.GHCR_REGISTRY}/tale-sandbox-runtime:${version}`
        : null;
      if (runtimeImageRemote) {
        imagesToPull.push(runtimeImageRemote);
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
      } else {
        const failedImages: string[] = [];
        for (const image of imagesToPull) {
          const success = await pullImage(image);
          if (!success) {
            failedImages.push(image);
          }
        }
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
        // only when CONTROLLER_TOKEN is set; bring it up alongside the stateful
        // services (it isn't in any rotation list of its own). Idempotent.
        const controllerEnabled = Boolean(process.env.CONTROLLER_TOKEN);
        const statefulUp = controllerEnabled
          ? [...statefulToUpdate, 'controller']
          : [...statefulToUpdate];

        if (dryRun) {
          for (const service of statefulUp) {
            logger.info(`${prefix}Would deploy stateful service: ${service}`);
          }
        } else {
          const result = await dockerCompose(
            statefulCompose,
            [
              'up',
              '-d',
              ...(options.forceRecreate ? ['--force-recreate'] : []),
              ...statefulUp,
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

          for (const service of statefulUp) {
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

          // The controller is a non-critical opt-in sidecar: warn if it doesn't
          // come up, but never fail the deploy of the core services over it.
          if (controllerEnabled) {
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

// Org slug shape — must match ORG_SLUG_REGEX at
// services/platform/lib/shared/constants/org-slug.ts and ORG_SLUG_RE at
// packages/tale_shared/src/tale_shared/config/org_slug.py. The 64-char
// cap (round-3 P1) aligns this file with the canonical validator;
// without it, the deploy-side enumerator would accept slugs the platform
// itself refuses to mint. Duplicated here because the CLI ships in a
// single compiled binary that does not import convex sources at runtime.
const ORG_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Top-level names under the project root that are legitimate per-domain
// dirs from the OLD flat layout (`agents/`, `workflows/`, …). Under
// org-first these don't belong at the root anymore — if any are present
// it's a legacy project that hasn't been re-init'd. Refuse to push (would
// silently land in `/app/data/agents/` etc., which the new resolvers don't
// read) and point the operator at `tale init --force`.
export const LEGACY_DOMAIN_DIR_NAMES = new Set([
  'agents',
  'workflows',
  'integrations',
  'branding',
  'providers',
  'skills',
  'retention',
]);

function isValidOrgSlug(name: string): boolean {
  // Mirrors `validateOrgSlug` in shared/constants/org-slug.ts — no length
  // cap (the canonical validator imposes none, and adding one here would
  // silently drop legitimate long slugs from compose mounts).
  return name === 'default' || ORG_SLUG_REGEX.test(name);
}

async function findOrgDirs(
  projectDir: string,
): Promise<{ orgDirs: string[]; legacyDirs: string[] }> {
  const orgDirs: string[] = [];
  const legacyDirs: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return { orgDirs, legacyDirs };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith('.')) continue; // skips .tale, .git, .vscode, .DS_Store etc.
    if (LEGACY_DOMAIN_DIR_NAMES.has(name)) {
      legacyDirs.push(name);
      continue;
    }
    if (!isValidOrgSlug(name)) continue;
    orgDirs.push(name);
  }
  return { orgDirs, legacyDirs };
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

  const { orgDirs, legacyDirs } = await findOrgDirs(projectDir);

  if (legacyDirs.length > 0) {
    throw new Error(
      `Legacy flat layout detected at project root (${legacyDirs.join(', ')}/). ` +
        `Run 'tale migrate config-layout' then 'tale deploy --override-all -y' ` +
        `(see docs/self-hosted/operate/upgrades.md).`,
    );
  }

  if (orgDirs.length === 0) {
    logger.blank();
    logger.info(
      `${prefix}Nothing to push: no org directories found at host root (expected e.g. 'default/').`,
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
    for (const orgName of orgDirs) {
      const orgSrc = join(projectDir, orgName);
      const orgDst = join(stageDir, orgName);

      if (dryRun) {
        logger.info(
          `${prefix}Would push ${orgName}/ → ${containerName}:/app/data/${orgName}/ (excluding *.secrets.json, .history/, symlinks)`,
        );
        continue;
      }

      await stageOrgIntoDir(orgSrc, orgDst);
    }

    if (dryRun) {
      logger.info(
        `${prefix}Skipped at root: tale.json, .tale/, .env, .git/, dotfiles, ${legacyDirs.length ? `legacy ${legacyDirs.join(', ')}/, ` : ''}any other non-org-shaped entries`,
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
      `Overrode ${orgDirs.length} org${orgDirs.length === 1 ? '' : 's'}: ${orgDirs.join(', ')}`,
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
          console.warn(
            `[deploy.stageOrgIntoDir] lstat ${src} failed (${code ?? 'unknown'}); skipping`,
          );
        }
        return false;
      }
      return true;
    },
  });
}
