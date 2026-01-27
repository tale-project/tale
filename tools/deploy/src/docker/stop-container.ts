import { docker } from "./docker";
import * as logger from "../utils/logger";

export async function stopContainer(containerName: string): Promise<boolean> {
  logger.info(`Stopping container: ${containerName}`);
  const result = await docker("stop", containerName);
  return result.success;
}
