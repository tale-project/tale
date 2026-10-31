import * as logger from '../../utils/logger';
import { docker } from './docker';

/**
 * Delete one named volume. A volume that is not there counts as deleted; any
 * other refusal (a container still mounts it, a driver error) is logged with
 * the daemon's words. No `--force`: it would hide a missing volume, and the
 * daemon would then forget a volume whose data its driver failed to delete.
 */
export async function removeVolume(volumeName: string): Promise<boolean> {
  const result = await docker('volume', 'rm', volumeName);
  if (result.success) {
    logger.info(`Removed volume: ${volumeName}`);
    return true;
  }
  const error = result.stderr.trim();
  // Docker answers `get <name>: no such volume`; Podman's answer ends alike.
  if (/no such volume/i.test(error)) {
    logger.debug(`Volume ${volumeName} does not exist`);
    return true;
  }
  logger.warn(
    `Failed to remove volume ${volumeName}: ${error || 'no stderr captured'}`,
  );
  return false;
}
