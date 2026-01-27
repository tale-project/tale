import {
  type DeploymentColor,
  ROTATABLE_SERVICES,
  STATEFUL_SERVICES,
} from "../compose/types";
import {
  docker,
  isContainerRunning,
  removeContainer,
  stopContainer,
} from "../docker/client";
import { withLock } from "../state/lock";
import type { DeploymentEnv } from "../utils/env";
import * as logger from "../utils/logger";

interface ResetOptions {
  env: DeploymentEnv;
  force: boolean;
  includeStateful: boolean;
}

export async function resetCommand(options: ResetOptions): Promise<void> {
  const { env, force, includeStateful } = options;

  if (!force) {
    logger.error("Reset requires --force flag to confirm");
    logger.info("This will remove ALL blue-green containers");
    if (includeStateful) {
      logger.warn("--include-stateful will also remove db, graph-db, and proxy");
    }
    throw new Error("Reset requires --force confirmation");
  }

  await withLock(env.DEPLOY_DIR, "reset", async () => {
    logger.header("Resetting Deployment");

    // Remove all blue-green containers
    for (const color of ["blue", "green"] as DeploymentColor[]) {
      logger.step(`Removing ${color} containers...`);
      for (const service of ROTATABLE_SERVICES) {
        const containerName = `${env.PROJECT_NAME}-${service}-${color}`;
        const running = await isContainerRunning(containerName);
        if (running) {
          await stopContainer(containerName);
        }
        // Try to remove even if not running (might be stopped)
        await removeContainer(containerName);
      }
    }

    // Optionally remove stateful containers
    if (includeStateful) {
      logger.step("Removing stateful containers...");
      for (const service of STATEFUL_SERVICES) {
        const containerName = `${env.PROJECT_NAME}-${service}`;
        const running = await isContainerRunning(containerName);
        if (running) {
          await stopContainer(containerName);
        }
        await removeContainer(containerName);
      }
    }

    // Clean up state files
    logger.step("Cleaning up state files...");
    const stateFiles = [
      `${env.DEPLOY_DIR}/.deployment-color`,
      `${env.DEPLOY_DIR}/.deployment-previous-version`,
    ];

    for (const file of stateFiles) {
      try {
        const bunFile = Bun.file(file);
        if (await bunFile.exists()) {
          await import("node:fs/promises").then((fs) => fs.unlink(file));
          logger.info(`Removed ${file}`);
        }
      } catch {
        // Ignore errors
      }
    }

    // Prune unused networks and volumes (optional)
    logger.step("Pruning unused Docker resources...");
    await docker("network", "prune", "-f");

    logger.success("Reset complete! All blue-green containers removed");
    if (!includeStateful) {
      logger.info("Stateful services (db, graph-db, proxy) were preserved");
      logger.info("Use --include-stateful to remove them as well");
    }
  });
}
