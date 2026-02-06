import { docker } from "./docker";
import * as logger from "../../utils/logger";

export async function stopContainer(containerName: string): Promise<boolean> {
  const result = await docker("stop", containerName);
  if (result.success) {
    logger.info(`Stopped container: ${containerName}`);
  }
  return result.success;
}
