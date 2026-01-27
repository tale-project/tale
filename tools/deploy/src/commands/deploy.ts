import {
  generateColorCompose,
  generateStatefulCompose,
} from "../compose/generator";
import { ROTATABLE_SERVICES, STATEFUL_SERVICES } from "../compose/types";
import {
  dockerCompose,
  ensureNetwork,
  ensureVolumes,
  getContainerVersion,
  pullImage,
  removeContainer,
  stopContainer,
} from "../docker/client";
import { waitForHealthy } from "../docker/health";
import {
  getCurrentColor,
  getNextColor,
  setCurrentColor,
  setPreviousVersion,
} from "../state/deployment";
import { withLock } from "../state/lock";
import type { DeploymentEnv } from "../utils/env";
import * as logger from "../utils/logger";

interface DeployOptions {
  version: string;
  updateStateful: boolean;
  env: DeploymentEnv;
  hostAlias: string;
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  const { version, updateStateful, env, hostAlias } = options;

  await withLock(env.DEPLOY_DIR, `deploy ${version}`, async () => {
    logger.header(`Deploying Tale ${version}`);

    const serviceConfig = {
      version,
      registry: env.GHCR_REGISTRY,
      projectName: env.PROJECT_NAME,
    };

    // Pull all required images first
    logger.step("Pulling images...");
    const imagesToPull = [
      ...ROTATABLE_SERVICES.map(
        (s) => `${env.GHCR_REGISTRY}/tale-${s}:${version}`
      ),
    ];

    if (updateStateful) {
      imagesToPull.push(
        ...STATEFUL_SERVICES.map(
          (s) => `${env.GHCR_REGISTRY}/tale-${s}:${version}`
        )
      );
    }

    for (const image of imagesToPull) {
      const success = await pullImage(image);
      if (!success) {
        throw new Error(`Failed to pull image: ${image}`);
      }
    }

    // Deploy stateful services if requested
    if (updateStateful) {
      logger.step("Deploying stateful services...");
      const statefulCompose = generateStatefulCompose(serviceConfig, hostAlias);

      const result = await dockerCompose(
        statefulCompose,
        ["up", "-d", "--remove-orphans"],
        { projectName: env.PROJECT_NAME, cwd: env.DEPLOY_DIR }
      );

      if (!result.success) {
        logger.error("Failed to deploy stateful services");
        logger.error(result.stderr);
        throw new Error("Stateful deployment failed");
      }

      // Wait for stateful services to be healthy
      for (const service of STATEFUL_SERVICES) {
        const containerName = `${env.PROJECT_NAME}-${service}`;
        const healthy = await waitForHealthy(containerName, {
          timeout: env.HEALTH_CHECK_TIMEOUT,
        });
        if (!healthy) {
          throw new Error(`Service ${service} failed health check`);
        }
      }
    }

    // Get current color and determine next color
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    const nextColor = getNextColor(currentColor);

    logger.info(`Current color: ${currentColor ?? "none"}`);
    logger.info(`Deploying to: ${nextColor}`);

    // Save current version as previous (for rollback)
    if (currentColor) {
      const currentPlatformVersion = await getContainerVersion(
        `${env.PROJECT_NAME}-platform-${currentColor}`
      );
      if (currentPlatformVersion) {
        await setPreviousVersion(env.DEPLOY_DIR, currentPlatformVersion);
        logger.info(`Previous version saved: ${currentPlatformVersion}`);
      }
    }

    // Ensure required volumes and network exist for color services
    logger.step("Ensuring volumes and network exist...");
    const requiredVolumes = ["platform-convex-data", "caddy-data", "rag-data"];
    const volumesCreated = await ensureVolumes(env.PROJECT_NAME, requiredVolumes);
    if (!volumesCreated) {
      throw new Error("Failed to create required volumes");
    }
    const networkCreated = await ensureNetwork(env.PROJECT_NAME, "internal");
    if (!networkCreated) {
      throw new Error("Failed to create required network");
    }

    // Deploy new color
    logger.step(`Deploying ${nextColor} services...`);
    const colorCompose = generateColorCompose(
      serviceConfig,
      nextColor,
      env.PROJECT_NAME
    );

    const deployResult = await dockerCompose(
      colorCompose,
      ["up", "-d", "--remove-orphans"],
      { projectName: `${env.PROJECT_NAME}-${nextColor}`, cwd: env.DEPLOY_DIR }
    );

    if (!deployResult.success) {
      logger.error(`Failed to deploy ${nextColor} services`);
      logger.error(deployResult.stderr);
      throw new Error("Color deployment failed");
    }

    // Wait for new services to be healthy
    logger.step("Waiting for services to be healthy...");
    for (const service of ROTATABLE_SERVICES) {
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

      // Stop and remove old color containers
      logger.step(`Stopping ${currentColor} services...`);
      for (const service of ROTATABLE_SERVICES) {
        const containerName = `${env.PROJECT_NAME}-${service}-${currentColor}`;
        await stopContainer(containerName);
        await removeContainer(containerName);
      }
    }

    logger.success(`Deployment complete! Version ${version} is now live on ${nextColor}`);
  });
}
