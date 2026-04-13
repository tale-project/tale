import { open, rename, unlink } from 'node:fs/promises';

import * as logger from '../../utils/logger';
import type { TaleProject } from './types';

/**
 * Atomically write tale.json (or any JSON project file).
 *
 * Pattern: write to a sibling temp file, fsync, rename. POSIX rename is
 * atomic on the same filesystem, so a crash mid-write leaves the original
 * file intact rather than producing a truncated tale.json that would brick
 * every subsequent `tale` command.
 */
export async function writeProject(
  path: string,
  project: TaleProject,
): Promise<void> {
  const tmp = `${path}.tmp`;
  const content = JSON.stringify(project, null, 2) + '\n';
  let handle;
  try {
    handle = await open(tmp, 'w');
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch((cleanupErr: NodeJS.ErrnoException) => {
      if (cleanupErr.code !== 'ENOENT') {
        logger.debug(`Failed to clean up ${tmp}: ${cleanupErr.message}`);
      }
    });
    throw err;
  }
}
