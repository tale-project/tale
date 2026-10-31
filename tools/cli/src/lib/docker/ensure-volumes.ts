import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { docker } from './docker';

export async function volumeExists(volumeName: string): Promise<boolean> {
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
  // Label the volume with its project ID, as `ensure-network.ts` labels the
  // networks: `docker volume ls --filter label=project=<id>` lists them.
  // `tale reset --all` deletes volumes by name, not by this label: the
  // snapshots and the dev stack's volumes carry it too.
  const result = await docker(
    'volume',
    'create',
    '--label',
    `project=${getProjectId()}`,
    volumeName,
  );
  if (!result.success) {
    logger.error(
      `Failed to create volume ${volumeName}: ${result.stderr.trim()}`,
    );
  }
  return result.success;
}

/**
 * Ensure the named volumes exist, namespaced under the given prefix.
 * Default prefix is `${projectId}_` (prod); dev should pass `${projectId}-dev_`.
 */
export async function ensureVolumes(
  volumeNames: string[],
  prefix: string = `${getProjectId()}_`,
): Promise<boolean> {
  for (const name of volumeNames) {
    const fullName = `${prefix}${name}`;
    const success = await createVolume(fullName);
    if (!success) {
      // createVolume already logged the underlying stderr.
      return false;
    }
  }
  return true;
}
