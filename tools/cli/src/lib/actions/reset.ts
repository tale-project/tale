import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { ROTATABLE_SERVICES, STATEFUL_SERVICES } from "../compose/types";
import type { DeploymentColor } from "../compose/types";
import { docker } from "../docker/docker";
import { removeContainer } from "../docker/remove-container";
import { withLock } from "../state/with-lock";
import { confirm } from "../../utils/confirm";
import type { DeploymentEnv } from "../../utils/load-env";
import * as logger from "../../utils/logger";

interface ResetOptions {
  env: DeploymentEnv;
  force: boolean;
  includeStateful: boolean;
  dryRun: boolean;
}

export async function reset(options: ResetOptions): Promise<void> {
  const { env, force, includeStateful, dryRun } = options;

  logger.warn("This will remove ALL blue-green containers");
  if (includeStateful) {
    logger.warn("Including stateful services: db, graph-db, proxy");
  }

  if (!force) {
    const confirmed = await confirm("Are you sure you want to reset?");
    if (!confirmed) {
      logger.info("Reset cancelled");
      return;
    }
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
          logger.info(`${prefix}Would remove: ${containerName}`);
        } else {
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
          logger.info(`${prefix}Would remove: ${containerName}`);
        } else {
          await removeContainer(containerName);
        }
      }
    }

    // Clean up state files
    logger.step(`${prefix}Cleaning up state files...`);
    const stateFiles = [
      join(env.DEPLOY_DIR, ".deployment-color"),
      join(env.DEPLOY_DIR, ".deployment-previous-version"),
    ];

    for (const file of stateFiles) {
      if (dryRun) {
        logger.info(`${prefix}Would remove: ${file}`);
      } else {
        try {
          await unlink(file);
          logger.info(`Removed ${file}`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            logger.warn(`Failed to remove ${file}: ${err}`);
          }
        }
      }
    }

    // Prune unused networks for this project only
    logger.step(`${prefix}Pruning unused Docker networks...`);
    if (!dryRun) {
      await docker("network", "prune", "-f", "--filter", `label=project=${env.PROJECT_NAME}`);
    } else {
      logger.info(`${prefix}Would prune unused Docker networks for project ${env.PROJECT_NAME}`);
    }

    if (dryRun) {
      logger.success(`${prefix}Dry-run complete! Would remove all blue-green containers`);
    } else {
      logger.success("Reset complete! All blue-green containers removed");
    }
    if (!includeStateful) {
      logger.info("Stateful services (db, graph-db, proxy) were preserved");
      logger.info("Use --all to remove them as well");
    }
  });
}
