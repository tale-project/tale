import { generateColorCompose } from "../../lib/compose/generators/generate-color-compose";
import { generateStatefulCompose } from "../../lib/compose/generators/generate-stateful-compose";
import {
  type RotatableService,
  type ServiceName,
  type StatefulService,
  ROTATABLE_SERVICES,
  STATEFUL_SERVICES,
  isRotatableService,
  isStatefulService,
} from "../../lib/compose/types";
import { dockerCompose } from "../../lib/docker/docker-compose";
import { ensureNetwork } from "../../lib/docker/ensure-network";
import { ensureVolumes } from "../../lib/docker/ensure-volumes";
import { getContainerVersion } from "../../lib/docker/get-container-version";
import { pullImage } from "../../lib/docker/pull-image";
import { removeContainer } from "../../lib/docker/remove-container";
import { stopContainer } from "../../lib/docker/stop-container";
import { waitForHealthy } from "../../lib/docker/wait-for-healthy";
import { getCurrentColor } from "../../lib/state/get-current-color";
import { getNextColor } from "../../lib/state/get-next-color";
import { setCurrentColor } from "../../lib/state/set-current-color";
import { setPreviousVersion } from "../../lib/state/set-previous-version";
import { withLock } from "../../lib/state/with-lock";
import type { DeploymentEnv } from "../../utils/load-env";
import * as logger from "../../utils/logger";

const REQUIRED_VOLUMES = ["platform-convex-data", "caddy-data", "rag-data"];

async function ensureInfrastructure(
  projectName: string,
  prefix: string,
  dryRun: boolean
): Promise<void> {
  logger.step(`${prefix}Ensuring volumes and network exist...`);
  if (dryRun) {
    for (const vol of REQUIRED_VOLUMES) {
      logger.info(`${prefix}Would ensure volume: ${projectName}_${vol}`);
    }
    logger.info(`${prefix}Would ensure network: ${projectName}_internal`);
    return;
  }

  const volumesCreated = await ensureVolumes(projectName, REQUIRED_VOLUMES);
  if (!volumesCreated) {
    throw new Error("Failed to create required volumes");
  }
  const networkCreated = await ensureNetwork(projectName, "internal");
  if (!networkCreated) {
    throw new Error("Failed to create required network");
  }
}

interface DeployOptions {
  version: string;
  updateStateful: boolean;
  env: DeploymentEnv;
  hostAlias: string;
  dryRun: boolean;
  services?: ServiceName[];
}

export async function deploy(options: DeployOptions): Promise<void> {
  const { version, updateStateful, env, hostAlias, dryRun, services } = options;

  await withLock(env.DEPLOY_DIR, `deploy ${version}`, async () => {
    const prefix = dryRun ? "[DRY-RUN] " : "";
    logger.header(`${prefix}Deploying Tale ${version}`);

    // Determine which services to deploy
    let rotatableToUpdate: RotatableService[];
    let statefulToUpdate: StatefulService[];

    if (services && services.length > 0) {
      // User specified explicit services
      rotatableToUpdate = services.filter(isRotatableService);
      statefulToUpdate = services.filter(isStatefulService);
    } else {
      // Default: all rotatable services, stateful only if --all
      rotatableToUpdate = [...ROTATABLE_SERVICES];
      statefulToUpdate = updateStateful ? [...STATEFUL_SERVICES] : [];
    }

    if (rotatableToUpdate.length === 0 && statefulToUpdate.length === 0) {
      logger.error("No valid services to deploy");
      throw new Error("No services specified");
    }

    // Determine deployment mode
    const inPlaceUpdate = services && services.length > 0;
    if (inPlaceUpdate) {
      logger.info("Mode: In-place update (no blue-green switching)");
    } else {
      logger.info("Mode: Blue-green deployment");
    }
    logger.info(`Rotatable services: ${rotatableToUpdate.join(", ") || "none"}`);
    logger.info(`Stateful services: ${statefulToUpdate.join(", ") || "none"}`);

    const serviceConfig = {
      version,
      registry: env.GHCR_REGISTRY,
      projectName: env.PROJECT_NAME,
    };

    // Pull all required images first
    logger.step(`${prefix}Pulling images...`);
    const imagesToPull = [
      ...rotatableToUpdate.map(
        (s) => `${env.GHCR_REGISTRY}/tale-${s}:${version}`
      ),
      ...statefulToUpdate.map(
        (s) => `${env.GHCR_REGISTRY}/tale-${s}:${version}`
      ),
    ];

    if (dryRun) {
      for (const image of imagesToPull) {
        logger.info(`${prefix}Would pull: ${image}`);
      }
    } else {
      for (const image of imagesToPull) {
        const success = await pullImage(image);
        if (!success) {
          throw new Error(`Failed to pull image: ${image}`);
        }
      }
    }

    // Deploy stateful services if any
    if (statefulToUpdate.length > 0) {
      logger.step(`${prefix}Deploying stateful services...`);
      const statefulCompose = generateStatefulCompose(serviceConfig, hostAlias);

      if (dryRun) {
        for (const service of statefulToUpdate) {
          logger.info(`${prefix}Would deploy stateful service: ${service}`);
        }
      } else {
        const result = await dockerCompose(
          statefulCompose,
          ["up", "-d", ...statefulToUpdate],
          { projectName: env.PROJECT_NAME, cwd: env.DEPLOY_DIR }
        );

        if (!result.success) {
          logger.error("Failed to deploy stateful services");
          logger.error(result.stderr);
          throw new Error("Stateful deployment failed");
        }

        // Wait for stateful services to be healthy
        for (const service of statefulToUpdate) {
          const containerName = `${env.PROJECT_NAME}-${service}`;
          const healthy = await waitForHealthy(containerName, {
            timeout: env.HEALTH_CHECK_TIMEOUT,
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
        const currentColor = await getCurrentColor(env.DEPLOY_DIR);
        if (!currentColor) {
          logger.error("No active deployment found");
          logger.info("Run a full deploy first (without --services)");
          throw new Error("No active deployment for in-place update");
        }

        logger.info(`Updating in current color: ${currentColor}`);

        await ensureInfrastructure(env.PROJECT_NAME, prefix, dryRun);

        // Update services in current color
        logger.step(`${prefix}Updating ${currentColor} services...`);
        const colorCompose = generateColorCompose(
          serviceConfig,
          currentColor,
          env.PROJECT_NAME
        );

        if (dryRun) {
          for (const service of rotatableToUpdate) {
            logger.info(`${prefix}Would update: ${env.PROJECT_NAME}-${service}-${currentColor}`);
          }
        } else {
          const deployResult = await dockerCompose(
            colorCompose,
            ["up", "-d", ...rotatableToUpdate],
            { projectName: `${env.PROJECT_NAME}-${currentColor}`, cwd: env.DEPLOY_DIR }
          );

          if (!deployResult.success) {
            logger.error(`Failed to update ${currentColor} services`);
            logger.error(deployResult.stderr);
            throw new Error("In-place update failed");
          }

          // Wait for services to be healthy
          logger.step("Waiting for services to be healthy...");
          for (const service of rotatableToUpdate) {
            const containerName = `${env.PROJECT_NAME}-${service}-${currentColor}`;
            const healthy = await waitForHealthy(containerName, {
              timeout: env.HEALTH_CHECK_TIMEOUT,
            });
            if (!healthy) {
              throw new Error(`Service ${service}-${currentColor} failed health check`);
            }
          }
        }
      } else {
        // Full blue-green deployment
        const currentColor = await getCurrentColor(env.DEPLOY_DIR);
        const nextColor = getNextColor(currentColor);

        logger.info(`Current color: ${currentColor ?? "none"}`);
        logger.info(`Deploying to: ${nextColor}`);

        // Save current version as previous (for rollback)
        if (currentColor && !dryRun) {
          const currentPlatformVersion = await getContainerVersion(
            `${env.PROJECT_NAME}-platform-${currentColor}`
          );
          if (currentPlatformVersion) {
            await setPreviousVersion(env.DEPLOY_DIR, currentPlatformVersion);
            logger.info(`Previous version saved: ${currentPlatformVersion}`);
          }
        }

        await ensureInfrastructure(env.PROJECT_NAME, prefix, dryRun);

        // Deploy new color
        logger.step(`${prefix}Deploying ${nextColor} services...`);
        const colorCompose = generateColorCompose(
          serviceConfig,
          nextColor,
          env.PROJECT_NAME
        );

        if (dryRun) {
          for (const service of rotatableToUpdate) {
            logger.info(`${prefix}Would deploy: ${env.PROJECT_NAME}-${service}-${nextColor}`);
          }
          logger.step(`${prefix}Would switch traffic to ${nextColor}`);
          if (currentColor) {
            logger.step(`${prefix}Would drain ${currentColor} services (${env.DRAIN_TIMEOUT}s)`);
            for (const service of rotatableToUpdate) {
              logger.info(`${prefix}Would stop/remove: ${env.PROJECT_NAME}-${service}-${currentColor}`);
            }
          }
        } else {
          const deployResult = await dockerCompose(
            colorCompose,
            ["up", "-d", ...rotatableToUpdate],
            { projectName: `${env.PROJECT_NAME}-${nextColor}`, cwd: env.DEPLOY_DIR }
          );

          if (!deployResult.success) {
            logger.error(`Failed to deploy ${nextColor} services`);
            logger.error(deployResult.stderr);
            throw new Error("Color deployment failed");
          }

          // Wait for new services to be healthy
          logger.step("Waiting for services to be healthy...");
          for (const service of rotatableToUpdate) {
            const containerName = `${env.PROJECT_NAME}-${service}-${nextColor}`;
            const healthy = await waitForHealthy(containerName, {
              timeout: env.HEALTH_CHECK_TIMEOUT,
            });
            if (!healthy) {
              throw new Error(`Service ${service}-${nextColor} failed health check`);
            }
          }

          // Switch traffic to new color
          logger.step(`Switching traffic to ${nextColor}...`);
          await setCurrentColor(env.DEPLOY_DIR, nextColor);

          // Drain old color (if exists)
          if (currentColor) {
            logger.step(`Draining ${currentColor} services (${env.DRAIN_TIMEOUT}s)...`);
            await Bun.sleep(env.DRAIN_TIMEOUT * 1000);

            // Stop and remove old color containers (non-fatal - traffic already switched)
            logger.step(`Stopping ${currentColor} services...`);
            for (const service of rotatableToUpdate) {
              const containerName = `${env.PROJECT_NAME}-${service}-${currentColor}`;
              const stopped = await stopContainer(containerName);
              if (!stopped) {
                logger.warn(`Failed to stop ${containerName}, continuing...`);
              }
              const removed = await removeContainer(containerName);
              if (!removed) {
                logger.warn(`Failed to remove ${containerName}, continuing...`);
              }
            }
          }
        }
      }
    }

    if (dryRun) {
      logger.success(`${prefix}Dry-run complete! Would deploy version ${version}`);
    } else {
      logger.success(`Deployment complete! Version ${version} is now live`);
    }
  });
}
