import * as logger from '../../utils/logger';
import { docker } from './docker';

function isNotFoundError(stderr: string): boolean {
  return /not found|manifest unknown|name unknown/i.test(stderr);
}

export async function pullImage(image: string): Promise<boolean> {
  logger.info(`Pulling image: ${image}`);
  try {
    const result = await docker('pull', image);
    if (!result.success) {
      logger.error(`Failed to pull image: ${image}`);
      if (isNotFoundError(result.stderr)) {
        logger.error(
          'The image does not exist in the registry. If this is a recent release, the images may still be building. Wait a few minutes and try again.',
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
