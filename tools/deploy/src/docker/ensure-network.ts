import { docker } from "./docker";
import * as logger from "../utils/logger";

async function networkExists(networkName: string): Promise<boolean> {
  const result = await docker("network", "inspect", networkName);
  return result.success;
}

async function createNetwork(networkName: string): Promise<boolean> {
  const exists = await networkExists(networkName);
  if (exists) {
    logger.debug(`Network ${networkName} already exists`);
    return true;
  }

  logger.info(`Creating network: ${networkName}`);
  const result = await docker("network", "create", networkName);
  if (!result.success) {
    logger.error(`Failed to create network: ${networkName}`);
  }
  return result.success;
}

export async function ensureNetwork(
  projectName: string,
  networkName: string
): Promise<boolean> {
  const fullName = `${projectName}_${networkName}`;
  return createNetwork(fullName);
}
