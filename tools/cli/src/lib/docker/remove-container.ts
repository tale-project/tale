import { docker } from "./docker";
import * as logger from "../../utils/logger";

export async function removeContainer(containerName: string): Promise<boolean> {
  logger.info(`Removing container: ${containerName}`);
  const result = await docker("rm", "-f", containerName);
  if (!result.success) {
    const error = result.stderr?.trim();
    if (error && !error.includes("No such container")) {
      logger.warn(`Failed to remove ${containerName}: ${error}`);
    }
  }
  return result.success;
}
