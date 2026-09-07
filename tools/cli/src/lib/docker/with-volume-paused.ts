import * as logger from '../../utils/logger';
import { docker } from './docker';

/**
 * Pausing the writers of a volume for the duration of a read of it.
 *
 * Two lanes need exactly this and used to have it only once: the pre-deploy
 * snapshot (a live tar of a running Postgres data dir is not restorable) and
 * the config-volume migration (a `cp -a` that races the backend's own writes
 * copies a half-written config tree). The pause typically lasts seconds;
 * unpause is guaranteed via `finally`, and a failure to unpause shouts,
 * because a container left paused is an outage.
 */
export async function listContainersUsingVolume(
  volumeName: string,
): Promise<string[]> {
  const result = await docker('ps', '-q', '--filter', `volume=${volumeName}`);
  if (!result.success) {
    throw new Error(
      `Failed to list containers using volume ${volumeName}: ${result.stderr}`,
    );
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Run `work` with every running container that mounts any of `volumeNames`
 * paused. `work` receives how many were paused, so a caller can report it.
 *
 * A container that cannot be paused fails the whole operation BEFORE any of
 * the read happens — a partially paused set would produce exactly the torn
 * copy the pause exists to prevent.
 */
export async function withVolumeContainersPaused<T>(
  volumeNames: readonly string[],
  work: (pausedCount: number) => Promise<T>,
): Promise<T> {
  const users = new Set<string>();
  for (const volumeName of volumeNames) {
    for (const containerId of await listContainersUsingVolume(volumeName)) {
      users.add(containerId);
    }
  }

  const paused: string[] = [];
  try {
    for (const containerId of users) {
      const result = await docker('pause', containerId);
      if (!result.success) {
        throw new Error(
          `Failed to pause container ${containerId} before reading ${volumeNames.join(', ')}: ${result.stderr}`,
        );
      }
      paused.push(containerId);
    }
    return await work(paused.length);
  } finally {
    for (const containerId of paused) {
      const result = await docker('unpause', containerId);
      if (!result.success) {
        // Never throw from this cleanup path (it would mask the original
        // error) — but a still-paused container is an outage, so shout.
        logger.error(
          `Failed to unpause container ${containerId}: ${result.stderr}`,
        );
        logger.error(`  Run manually: docker unpause ${containerId}`);
      }
    }
  }
}
