import { generateColorCompose } from "../compose/generator";
import { ROTATABLE_SERVICES } from "../compose/types";
import {
  dockerCompose,
  pullImage,
  removeContainer,
  stopContainer,
} from "../docker/client";
import { waitForHealthy } from "../docker/health";
import {
  getCurrentColor,
  getOppositeColor,
  getPreviousVersion,
  setCurrentColor,
} from "../state/deployment";
import { withLock } from "../state/lock";
import type { DeploymentEnv } from "../utils/env";
import * as logger from "../utils/logger";

interface RollbackOptions {
  env: DeploymentEnv;
  version?: string;
}

export async function rollbackCommand(options: RollbackOptions): Promise<void> {
  const { env, version: targetVersion } = options;

  await withLock(env.DEPLOY_DIR, "rollback", async () => {
    logger.header("Rolling Back Deployment");

    // Get current state
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    if (!currentColor) {
      logger.error("No active deployment to rollback from");
      throw new Error("No active deployment");
    }

    // Determine rollback version: use provided version or fall back to previous
    let rollbackVersion: string;
    if (targetVersion) {
      rollbackVersion = targetVersion.replace(/^v/, "");
      logger.info(`Using specified version: ${rollbackVersion}`);
    } else {
      const previousVersion = await getPreviousVersion(env.DEPLOY_DIR);
      if (!previousVersion) {
        logger.error("No previous version found to rollback to");
        logger.info("Use --version <version> to specify a version explicitly");
        throw new Error("No previous version");
      }
      rollbackVersion = previousVersion;
    }

    const rollbackColor = getOppositeColor(currentColor);

    logger.info(`Current color: ${currentColor}`);
    logger.info(`Rolling back to: ${rollbackColor} (version ${rollbackVersion})`);

    const serviceConfig = {
      version: rollbackVersion,
      registry: env.GHCR_REGISTRY,
      projectName: env.PROJECT_NAME,
    };

    // Pull previous version images
    logger.step("Pulling previous version images...");
    for (const service of ROTATABLE_SERVICES) {
      const image = `${env.GHCR_REGISTRY}/tale-${service}:${rollbackVersion}`;
      const success = await pullImage(image);
      if (!success) {
        throw new Error(`Failed to pull image: ${image}`);
      }
    }

    // Deploy rollback color
    logger.step(`Deploying ${rollbackColor} services with version ${rollbackVersion}...`);
    const colorCompose = generateColorCompose(
      serviceConfig,
      rollbackColor,
      env.PROJECT_NAME
    );

    const deployResult = await dockerCompose(
      colorCompose,
      ["up", "-d"],
      { projectName: `${env.PROJECT_NAME}-${rollbackColor}`, cwd: env.DEPLOY_DIR }
    );

    if (!deployResult.success) {
      logger.error(`Failed to deploy ${rollbackColor} services`);
      logger.error(deployResult.stderr);
      throw new Error("Rollback deployment failed");
    }

    // Wait for services to be healthy
    logger.step("Waiting for services to be healthy...");
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${env.PROJECT_NAME}-${service}-${rollbackColor}`;
      const healthy = await waitForHealthy(containerName, {
        timeout: env.HEALTH_CHECK_TIMEOUT,
      });
      if (!healthy) {
        throw new Error(`Service ${service}-${rollbackColor} failed health check`);
      }
    }

    // Switch traffic
    logger.step(`Switching traffic to ${rollbackColor}...`);
    await setCurrentColor(env.DEPLOY_DIR, rollbackColor);

    // Drain current color
    logger.step(`Draining ${currentColor} services (${env.DRAIN_TIMEOUT}s)...`);
    await Bun.sleep(env.DRAIN_TIMEOUT * 1000);

    // Stop and remove current color containers
    logger.step(`Stopping ${currentColor} services...`);
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${env.PROJECT_NAME}-${service}-${currentColor}`;
      await stopContainer(containerName);
      await removeContainer(containerName);
    }

    logger.success(`Rollback complete! Version ${rollbackVersion} is now live on ${rollbackColor}`);
  });
}
