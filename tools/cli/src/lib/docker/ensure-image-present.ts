import * as defaultLogger from '../../utils/logger';
import { docker as defaultDocker } from './docker';
import { pullImage as defaultPullImage } from './pull-image';

interface EnsureImageDeps {
  docker: typeof defaultDocker;
  pullImage: typeof defaultPullImage;
  logger: Pick<typeof defaultLogger, 'warn'>;
}

/** Whether the daemon already holds this image. */
export async function imagePresent(
  image: string,
  docker: typeof defaultDocker = defaultDocker,
): Promise<boolean> {
  return (await docker('image', 'inspect', image)).success;
}

/**
 * Fetch `image` unless the daemon already holds it.
 *
 * For an image the CLI runs itself before compose does — the config-mountpoint
 * helper runs on the app image, and waiting for that download inside a step
 * labelled "Preparing volumes & networks" spends minutes of a first run under
 * a label that says nothing about a download.
 *
 * Best-effort, like the rest of the pre-compose image work: compose pulls the
 * same image moments later and reports its own failure, so a warning here
 * beats a second error message for one cause.
 */
export async function ensureImagePresent(
  image: string,
  {
    docker = defaultDocker,
    pullImage = defaultPullImage,
    logger = defaultLogger,
  }: Partial<EnsureImageDeps> = {},
): Promise<boolean> {
  if (await imagePresent(image, docker)) {
    return true;
  }
  if (await pullImage(image)) {
    return true;
  }
  logger.warn(`Could not fetch ${image}; compose will try again.`);
  return false;
}
