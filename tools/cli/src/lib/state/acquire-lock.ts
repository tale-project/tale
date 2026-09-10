import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { getLockFilePath } from './get-lock-file-path';
import { type LockInfo, getLockInfo } from './get-lock-info';
import { acquireGuard, releaseGuard } from './lock-guard';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireLock(
  deployDir: string,
  command: string,
): Promise<boolean> {
  if (!(await acquireGuard(deployDir))) {
    logger.error('Deployment already in progress.');
    return false;
  }
  let retained = false;
  try {
    // Respect an operation started by the previous CLI too. PID metadata is
    // diagnostic/compatibility state; current callers hold the OS lock before
    // reading it, so stale cleanup cannot expose an acquisition window.
    const previous = await getLockInfo(deployDir);
    if (previous && isProcessRunning(previous.pid)) {
      logger.error(
        `Deployment already in progress (PID: ${previous.pid}, started: ${previous.startedAt})`,
      );
      return false;
    }
    const info: LockInfo = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      command,
    };
    // NOFOLLOW also protects a symlink installed after read-side admission.
    // Do not truncate until the opened descriptor is proven to be one file.
    const file = await open(
      getLockFilePath(deployDir),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    try {
      const status = await file.stat();
      if (!status.isFile() || status.nlink !== 1)
        throw preconditionError(
          'Deployment lock metadata is not a regular file.',
        );
      await file.truncate(0);
      await file.writeFile(JSON.stringify(info, null, 2));
    } finally {
      await file.close();
    }
    retained = true;
    logger.debug(`Acquired deployment lock (PID: ${process.pid})`);
    return true;
  } finally {
    if (!retained) await releaseGuard(deployDir);
  }
}
