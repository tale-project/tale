import { generateColorCompose } from "../compose/generators/generate-color-compose";
import { ROTATABLE_SERVICES } from "../compose/types";
import { dockerCompose } from "../docker/docker-compose";
import { getContainerVersion } from "../docker/get-container-version";
import { pullImage } from "../docker/pull-image";
import { removeContainer } from "../docker/remove-container";
import { stopContainer } from "../docker/stop-container";
import { waitForHealthy } from "../docker/wait-for-healthy";
import { getCurrentColor } from "../state/get-current-color";
import { getOppositeColor } from "../state/get-opposite-color";
import { getPreviousVersion } from "../state/get-previous-version";
import { setCurrentColor } from "../state/set-current-color";
import { setPreviousVersion } from "../state/set-previous-version";
import { withLock } from "../state/with-lock";
import type { DeploymentEnv } from "../../utils/load-env";
import * as logger from "../../utils/logger";

interface RollbackOptions {
  env: DeploymentEnv;
  version?: string;
}

export async function rollback(options: RollbackOptions): Promise<void> {
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

    // Get current version before rollback (for version history)
    const currentVersion = await getContainerVersion(
      `${env.PROJECT_NAME}-platform-${currentColor}`
    );

    logger.info(`Current color: ${currentColor}`);
    logger.info(`Current version: ${currentVersion ?? "unknown"}`);
    logger.info(`Rolling back to: ${rollbackColor} (version ${rollbackVersion})`);

    const serviceConfig = {
      version: rollbackVersion,
      registry: env.GHCR_REGISTRY,
      projectName: env.PROJECT_NAME,
    };

    // Pull previous version images concurrently
    logger.step("Pulling previous version images...");
    const pullResults = await Promise.all(
      ROTATABLE_SERVICES.map((service) => {
        const image = `${env.GHCR_REGISTRY}/tale-${service}:${rollbackVersion}`;
        return pullImage(image).then((success) => ({ image, success }));
      })
    );
    const failedPull = pullResults.find((r) => !r.success);
    if (failedPull) {
      throw new Error(`Failed to pull image: ${failedPull.image}`);
    }

    // Deploy rollback color
    logger.step(`Deploying ${rollbackColor} services with version ${rollbackVersion}...`);
    const colorCompose = generateColorCompose(serviceConfig, rollbackColor);

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

    // Switch traffic and update version history
    logger.step(`Switching traffic to ${rollbackColor}...`);
    await setCurrentColor(env.DEPLOY_DIR, rollbackColor);
    if (currentVersion) {
      await setPreviousVersion(env.DEPLOY_DIR, currentVersion);
      logger.info(`Version history updated: previous=${currentVersion}`);
    }

    // Drain current color
    logger.step(`Draining ${currentColor} services (${env.DRAIN_TIMEOUT}s)...`);
    await Bun.sleep(env.DRAIN_TIMEOUT * 1000);

    // Stop and remove current color containers
    logger.step(`Stopping ${currentColor} services...`);
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${env.PROJECT_NAME}-${service}-${currentColor}`;
      const stopped = await stopContainer(containerName);
      if (!stopped) {
        logger.warn(`Failed to stop ${containerName}`);
      }
      const removed = await removeContainer(containerName);
      if (!removed) {
        logger.warn(`Failed to remove ${containerName}`);
      }
    }

    logger.success(`Rollback complete! Version ${rollbackVersion} is now live on ${rollbackColor}`);
  });
}
