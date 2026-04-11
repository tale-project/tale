import * as logger from '../../utils/logger';
import { docker } from './docker';

function isManifestNotFound(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes('not found') || lower.includes('manifest unknown');
}

export async function pullImage(image: string): Promise<boolean> {
  logger.info(`Pulling image: ${image}`);
  try {
    const result = await docker('pull', image);
    if (!result.success) {
      logger.error(`Failed to pull image: ${image}`);
      if (isManifestNotFound(result.stderr)) {
        logger.warn(
          'If this is a recent release, the images may still be building. ' +
            'Wait a few minutes and try again.',
        );
      } else {
        logger.error(result.stderr);
      }
      return false;
    }
    return true;
  } catch (err) {
    logger.error(`Failed to pull image: ${image}`);
    logger.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}
