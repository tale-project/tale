import * as logger from '../../utils/logger';
import { acquireLock } from './acquire-lock';
import { releaseLock } from './release-lock';

export async function withLock<T>(
  deployDir: string,
  command: string,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired = await acquireLock(deployDir, command);
  if (!acquired) {
    throw new Error('Failed to acquire deployment lock');
  }

  try {
    return await fn();
  } finally {
    try {
      await releaseLock(deployDir);
    } catch (releaseErr) {
      logger.warn(`Failed to release lock: ${releaseErr}`);
    }
  }
}
