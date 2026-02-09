import { PROJECT_NAME } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { docker } from './docker';

async function networkExists(networkName: string): Promise<boolean> {
  const result = await docker('network', 'inspect', networkName);
  return result.success;
}

async function createNetwork(networkName: string): Promise<boolean> {
  const exists = await networkExists(networkName);
  if (exists) {
    logger.debug(`Network ${networkName} already exists`);
    return true;
  }

  logger.info(`Creating network: ${networkName}`);
  const result = await docker(
    'network',
    'create',
    '--label',
    `project=${PROJECT_NAME}`,
    networkName,
  );
  if (!result.success) {
    logger.error(`Failed to create network: ${networkName}`);
  }
  return result.success;
}

export async function ensureNetwork(networkName: string): Promise<boolean> {
  const fullName = `${PROJECT_NAME}_${networkName}`;
  return createNetwork(fullName);
}
