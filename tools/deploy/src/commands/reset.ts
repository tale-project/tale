import {
  type DeploymentColor,
  ROTATABLE_SERVICES,
  STATEFUL_SERVICES,
} from "../compose/types";
import { isContainerRunning, removeContainer, stopContainer } from "../docker/container";
import { docker } from "../docker/exec";
import { withLock } from "../state/lock";
import type { DeploymentEnv } from "../utils/env";
import * as logger from "../utils/logger";

interface ResetOptions {
  env: DeploymentEnv;
  force: boolean;
  includeStateful: boolean;
  dryRun: boolean;
}

export async function reset(options: ResetOptions): Promise<void> {
  const { env, force, includeStateful, dryRun } = options;

  if (!force) {
    logger.error("Reset requires --force flag to confirm");
    logger.info("This will remove ALL blue-green containers");
    if (includeStateful) {
      logger.warn("--include-stateful will also remove db, graph-db, and proxy");
    }
    throw new Error("Reset requires --force confirmation");
  }

  await withLock(env.DEPLOY_DIR, "reset", async () => {
    const prefix = dryRun ? "[DRY-RUN] " : "";
    logger.header(`${prefix}Resetting Deployment`);

    // Remove all blue-green containers
    for (const color of ["blue", "green"] as DeploymentColor[]) {
      logger.step(`${prefix}Removing ${color} containers...`);
      for (const service of ROTATABLE_SERVICES) {
        const containerName = `${env.PROJECT_NAME}-${service}-${color}`;
        if (dryRun) {
          logger.info(`${prefix}Would stop/remove: ${containerName}`);
        } else {
          const running = await isContainerRunning(containerName);
          if (running) {
            await stopContainer(containerName);
          }
          await removeContainer(containerName);
        }
      }
    }

    // Optionally remove stateful containers
    if (includeStateful) {
      logger.step(`${prefix}Removing stateful containers...`);
      for (const service of STATEFUL_SERVICES) {
        const containerName = `${env.PROJECT_NAME}-${service}`;
        if (dryRun) {
          logger.info(`${prefix}Would stop/remove: ${containerName}`);
        } else {
          const running = await isContainerRunning(containerName);
          if (running) {
            await stopContainer(containerName);
          }
          await removeContainer(containerName);
        }
      }
    }

    // Clean up state files
    logger.step(`${prefix}Cleaning up state files...`);
    const stateFiles = [
      `${env.DEPLOY_DIR}/.deployment-color`,
      `${env.DEPLOY_DIR}/.deployment-previous-version`,
    ];

    for (const file of stateFiles) {
      if (dryRun) {
        logger.info(`${prefix}Would remove: ${file}`);
      } else {
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
    }

    // Prune unused networks and volumes (optional)
    logger.step(`${prefix}Pruning unused Docker resources...`);
    if (!dryRun) {
      await docker("network", "prune", "-f");
    } else {
      logger.info(`${prefix}Would prune unused Docker networks`);
    }

    if (dryRun) {
      logger.success(`${prefix}Dry-run complete! Would remove all blue-green containers`);
    } else {
      logger.success("Reset complete! All blue-green containers removed");
    }
    if (!includeStateful) {
      logger.info("Stateful services (db, graph-db, proxy) were preserved");
      logger.info("Use --include-stateful to remove them as well");
    }
  });
}
