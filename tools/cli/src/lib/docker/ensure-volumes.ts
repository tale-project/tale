import { PROJECT_NAME } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { docker } from './docker';

async function volumeExists(volumeName: string): Promise<boolean> {
  const result = await docker('volume', 'inspect', volumeName);
  return result.success;
}

async function createVolume(volumeName: string): Promise<boolean> {
  const exists = await volumeExists(volumeName);
  if (exists) {
    logger.debug(`Volume ${volumeName} already exists`);
    return true;
  }

  logger.info(`Creating volume: ${volumeName}`);
  const result = await docker('volume', 'create', volumeName);
  return result.success;
}

export async function ensureVolumes(volumeNames: string[]): Promise<boolean> {
  for (const name of volumeNames) {
    const fullName = `${PROJECT_NAME}_${name}`;
    const success = await createVolume(fullName);
    if (!success) {
      logger.error(`Failed to create volume: ${fullName}`);
      return false;
    }
  }
  return true;
}
