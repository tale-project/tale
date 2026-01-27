import { docker } from "./exec";
import * as logger from "../utils/logger";

export async function pullImage(image: string): Promise<boolean> {
  logger.info(`Pulling image: ${image}`);
  const result = await docker("pull", image);
  if (!result.success) {
    logger.error(`Failed to pull image: ${image}`);
    logger.error(result.stderr);
    return false;
  }
  return true;
}
