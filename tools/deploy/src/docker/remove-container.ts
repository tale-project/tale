import { docker } from "./docker";
import * as logger from "../utils/logger";

export async function removeContainer(containerName: string): Promise<boolean> {
  logger.info(`Removing container: ${containerName}`);
  const result = await docker("rm", "-f", containerName);
  return result.success;
}
