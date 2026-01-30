import { ROTATABLE_SERVICES } from "../compose/types";
import { containerExists } from "../docker/container-exists";
import { removeContainer } from "../docker/remove-container";
import { stopContainer } from "../docker/stop-container";
import { getCurrentColor } from "../state/get-current-color";
import { getOppositeColor } from "../state/get-opposite-color";
import { withLock } from "../state/with-lock";
import type { DeploymentEnv } from "../../utils/load-env";
import * as logger from "../../utils/logger";

interface CleanupOptions {
  env: DeploymentEnv;
}

export async function cleanup(options: CleanupOptions): Promise<void> {
  const { env } = options;

  await withLock(env.DEPLOY_DIR, "cleanup", async () => {
    logger.header("Cleaning Up Inactive Containers");

    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    if (!currentColor) {
      logger.info("No active deployment, nothing to clean up");
      return;
    }

    const inactiveColor = getOppositeColor(currentColor);
    logger.info(`Active color: ${currentColor}`);
    logger.info(`Cleaning up: ${inactiveColor}`);

    let cleaned = 0;
    for (const service of ROTATABLE_SERVICES) {
      const containerName = `${env.PROJECT_NAME}-${service}-${inactiveColor}`;
      const exists = await containerExists(containerName);

      if (exists) {
        await stopContainer(containerName);
        const removed = await removeContainer(containerName);
        if (removed) {
          cleaned++;
        } else {
          logger.warn(`Failed to remove ${containerName}`);
        }
      }
    }

    if (cleaned > 0) {
      logger.success(`Cleaned up ${cleaned} inactive container(s)`);
    } else {
      logger.info("No inactive containers to clean up");
    }
  });
}
