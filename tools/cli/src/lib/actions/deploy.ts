import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
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
  ROTATABLE_SERVICES,
  STATEFUL_SERVICES,
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
import { MIGRATIONS } from '../upgrade/registry';
import { runPendingMigrations } from '../upgrade/runner';

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
  fresh?: boolean;
  quiet?: boolean;
  /** Non-interactive acceptance of any pending migrations. */
  assumeYes?: boolean;
  /** @deprecated use assumeYes. Kept for one release of CLI back-compat. */
  migrateVolumes?: boolean;
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

      // Detect and apply any pending migrations before deploying. The runner
      // prints the plan and prompts the user (default No) when anything is
      // pending; non-interactive callers must pass --yes (aliased from the
      // deprecated --migrate-volumes). Declining aborts deploy cleanly.
      {
        const migrationResult = await runPendingMigrations(
          MIGRATIONS,
          { projectId: getProjectId(), projectDir: env.DEPLOY_DIR },
          {
            context: 'deploy',
            assumeYes: options.assumeYes ?? options.migrateVolumes,
            dryRun,
            async performStops(stops) {
              // `stops` may contain compose project names (e.g. 'tale',
              // 'tale-blue') and/or individual container names (e.g.
              // '${projectId}-platform-blue'). Try each as a compose project
              // first, fall back to plain `docker stop`. Failures MUST
              // surface — a silently-swallowed stop can let the migration
              // copy a live volume, corrupting data.
              for (const name of stops) {
                const composeDown = await exec(
                  'docker',
                  ['compose', '-p', name, 'down', '--remove-orphans'],
                  { silent: true },
                );
                if (composeDown.success) continue;
                const stopResult = await exec(
                  'docker',
                  ['stop', '-t', '30', name],
                  { silent: true },
                );
                if (stopResult.success) continue;
                const stderr = `${stopResult.stderr ?? ''}`.toLowerCase();
                const looksMissing =
                  stderr.includes('no such container') ||
                  stderr.includes('not found');
                if (!looksMissing) {
                  throw new Error(
                    `Failed to stop '${name}' before migration: ${stopResult.stderr?.trim() || 'unknown error'}`,
                  );
                }
              }
            },
          },
        );
        if (!migrationResult.proceed) {
          logger.info('Aborting deploy until migrations are approved.');
          return;
        }
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
        // Default: all rotatable services
        rotatableToUpdate = [...ROTATABLE_SERVICES];

        if (isFirstDeploy || updateStateful) {
          statefulToUpdate = [...STATEFUL_SERVICES];
          if (isFirstDeploy) {
            logger.notice(
              'First deployment detected - including infrastructure services',
            );
          }
        } else {
          // Check if any required stateful services are not running
          const missingStateful: StatefulService[] = [];
          for (const service of STATEFUL_SERVICES) {
            const containerName = `${getProjectId()}-${service}`;
            const running = await isContainerRunning(containerName);
            if (!running) {
              missingStateful.push(service);
            }
          }

          if (missingStateful.length > 0) {
            logger.notice(
              `Infrastructure services not running: ${missingStateful.join(', ')} - including automatically`,
            );
            statefulToUpdate = missingStateful;
          } else {
            statefulToUpdate = [];
          }
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
          { fresh: options.fresh },
        );

        if (dryRun) {
          for (const service of statefulToUpdate) {
            logger.info(`${prefix}Would deploy stateful service: ${service}`);
          }
        } else {
          const result = await dockerCompose(
            statefulCompose,
            ['up', '-d', ...statefulToUpdate],
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
              ['up', '-d', ...coloredServices],
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
              ['up', '-d', ...coloredServices],
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
        logger.success(`Deployment complete! Version ${version} is now live`);
      }

      // Sync project files to the convex container (owns convex-data volume rw)
      await syncProjectFiles(
        `${getProjectId()}-convex`,
        env.DEPLOY_DIR,
        dryRun,
        prefix,
        tempStageDirs,
      );
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
}

const SYNC_DIRS = [
  'agents',
  'workflows',
  'integrations',
  'branding',
  'providers',
];

async function syncProjectFiles(
  containerName: string,
  projectDir: string,
  dryRun: boolean,
  prefix: string,
  tempStageDirs: Set<string>,
): Promise<void> {
  const dirsToSync = SYNC_DIRS.filter((dir) =>
    existsSync(join(projectDir, dir)),
  );

  if (dirsToSync.length === 0) {
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
  logger.step(`${prefix}Syncing project files to ${containerName}...`);

  for (const dir of dirsToSync) {
    const srcPath = join(projectDir, dir);

    if (dryRun) {
      logger.info(
        `${prefix}Would sync ${dir}/ → ${containerName}:/app/data/${dir}/`,
      );
      if (dir === 'providers') {
        logger.info(
          `${prefix}  (any existing container *.secrets.json will be preserved)`,
        );
      }
      continue;
    }

    // INVARIANT: when dir === 'providers', `dockerSrcDir` must come from
    // stageProvidersWithoutConflictingSecrets() so that *.secrets.json files
    // written via the admin UI (SOPS-encrypted API keys, etc.) are not
    // clobbered by host copies. Do not remove this branch without also
    // moving the protection elsewhere.
    let dockerSrcDir = srcPath;
    let tempStageDir: string | null = null;
    let preserved: string[] = [];

    if (dir === 'providers') {
      const containerSecrets = await listContainerSecrets(containerName);
      if (containerSecrets.size > 0) {
        const staged = await stageProvidersWithoutConflictingSecrets(
          srcPath,
          containerSecrets,
        );
        tempStageDir = staged.stageDir;
        tempStageDirs.add(staged.stageDir);
        preserved = staged.skipped;
        dockerSrcDir = staged.stageDir;
      }
    }

    try {
      const dockerSrcPath = dockerSrcDir.replaceAll('\\', '/');
      const result = await exec('docker', [
        'cp',
        `${dockerSrcPath}/.`,
        `${containerName}:/app/data/${dir}/`,
      ]);

      if (result.success) {
        // docker cp copies files as root — fix ownership so the app user can write
        const chownResult = await exec('docker', [
          'exec',
          containerName,
          'chown',
          '-R',
          'app:app',
          `/app/data/${dir}/`,
        ]);
        if (!chownResult.success) {
          logger.warn(
            `Failed to fix ownership for ${dir}/: ${chownResult.stderr}`,
          );
        }
        logger.info(`Synced ${dir}/`);
        if (preserved.length > 0) {
          logger.info(
            `Preserved ${preserved.length} existing container secret(s) (host copy skipped to avoid overwriting UI edits):`,
          );
          for (const p of preserved) {
            logger.info(`  - providers/${p}`);
          }
          logger.info(
            `  To push host values instead: docker exec ${containerName} rm /app/data/providers/<file>, then redeploy.`,
          );
        }
      } else {
        logger.warn(`Failed to sync ${dir}/: ${result.stderr}`);
      }
    } finally {
      if (tempStageDir) {
        tempStageDirs.delete(tempStageDir);
        await rm(tempStageDir, { recursive: true, force: true });
      }
    }
  }

  if (!dryRun) {
    logger.success('Project files synced');
  }
}

// Enumerate *.secrets.json files already in the convex container so the
// subsequent docker cp can skip host copies that would overwrite them.
// Distinguishes benign "directory missing" (first deploy, empty volume) from
// hard failures (container unreachable, permission denied, etc.) — the latter
// aborts the deploy rather than silently reverting to the old overwrite
// behavior.
async function listContainerSecrets(
  containerName: string,
): Promise<Set<string>> {
  const result = await exec('docker', [
    'exec',
    containerName,
    'find',
    '/app/data/providers',
    '-type',
    'f',
    '-name',
    '*.secrets.json',
    '-printf',
    '%P\n',
  ]);
  if (result.success) {
    return new Set(
      result.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  if (/No such file or directory/.test(result.stderr)) {
    // Providers directory not yet created — nothing to protect.
    return new Set();
  }
  throw new Error(
    `Failed to enumerate container provider secrets on ${containerName}: ${result.stderr || 'unknown error'}`,
  );
}

// Copy host `providers/` into a fresh tmp dir and delete any *.secrets.json
// whose relative path also exists in the container. The resulting stage dir
// is what `docker cp` will ship — so conflicting secrets are preserved on the
// container side, non-conflicting files sync as before. fs.cp defaults to
// dereference=false, which keeps symlinks intact.
async function stageProvidersWithoutConflictingSecrets(
  srcDir: string,
  protectedRelPaths: Set<string>,
): Promise<{ stageDir: string; skipped: string[] }> {
  const stageDir = await mkdtemp(join(tmpdir(), 'tale-sync-'));
  await cp(srcDir, stageDir, { recursive: true });
  const skipped: string[] = [];
  for (const rel of protectedRelPaths) {
    // `rel` comes from the Linux container's find, so it uses '/'. Split
    // and re-join so Windows host paths resolve correctly against stageDir.
    const candidate = join(stageDir, ...rel.split('/'));
    if (existsSync(candidate)) {
      await rm(candidate);
      skipped.push(rel);
    }
  }
  return { stageDir, skipped };
}
