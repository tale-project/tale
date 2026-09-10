import { unlink } from 'node:fs/promises';

import { getLockFilePath } from './get-lock-file-path';
import { ownsGuard, releaseGuard, validateLockPaths } from './lock-guard';

export async function releaseLock(deployDir: string): Promise<void> {
  if (!(await ownsGuard(deployDir))) return;
  try {
    await validateLockPaths(deployDir);
    // Remove diagnostic metadata while still holding the kernel lock. Never
    // remove the SQLite file: a new inode would create a second lock.
    await unlink(getLockFilePath(deployDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    await releaseGuard(deployDir);
  }
}
