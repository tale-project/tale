import { link, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import * as logger from '../../utils/logger';
import { getLockFilePath } from './get-lock-file-path';
import { type LockInfo, getLockInfo } from './get-lock-info';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}

/**
 * Remove a stale lock without a check-then-act window. A plain `unlink` after
 * the pid check could delete a lock a SECOND `tale` created in between (it
 * saw the same stale lock, removed it and won its own `wx` create) — then
 * both would proceed. Instead the file is moved aside atomically: whoever
 * wins the `rename` owns the stale file, and it is deleted only if it still
 * carries the stale pid we observed. If a live process's fresh lock was
 * moved instead, it is put back with `link` — which fails EEXIST instead of
 * overwriting a lock a third caller created meanwhile — and this caller
 * loses at the `wx` create.
 */
async function takeOverStaleLock(
  lockPath: string,
  stalePid: number,
): Promise<void> {
  const aside = `${lockPath}.stale-${process.pid}`;
  try {
    await rename(lockPath, aside);
  } catch (err) {
    // ENOENT: another process already took the stale lock over; fall through
    // to the `wx` create, which decides who owns the new lock.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug(`Could not move stale lock aside: ${err}`);
    }
    return;
  }
  let movedPid: number | null = null;
  try {
    const parsed: unknown = JSON.parse(await Bun.file(aside).text());
    movedPid =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as LockInfo).pid === 'number'
        ? (parsed as LockInfo).pid
        : null;
  } catch (err) {
    logger.debug(`Could not read the moved-aside lock: ${err}`);
  }
  if (
    movedPid !== null &&
    movedPid !== stalePid &&
    isProcessRunning(movedPid)
  ) {
    // Not the stale lock: a live process acquired it between our check and
    // the rename. Hand it back; our own `wx` create will then fail. `link`
    // never replaces a lock a third caller `wx`-created in between (EEXIST):
    // that caller owns the lock now and the moved-aside copy is dropped.
    try {
      await link(aside, lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        logger.warn(`Could not restore a live lock moved aside: ${err}`);
        return;
      }
    }
  }
  try {
    await unlink(aside);
  } catch (err) {
    logger.debug(`Could not remove stale lock: ${err}`);
  }
}

export async function acquireLock(
  deployDir: string,
  command: string,
): Promise<boolean> {
  const lockPath = getLockFilePath(deployDir);

  const existingLock = await getLockInfo(deployDir);
  if (existingLock) {
    const isRunning = isProcessRunning(existingLock.pid);
    if (isRunning) {
      logger.error(
        `Deployment already in progress (PID: ${existingLock.pid}, started: ${existingLock.startedAt})`,
      );
      return false;
    }
    logger.warn(`Removing stale lock from PID ${existingLock.pid}`);
    await takeOverStaleLock(lockPath, existingLock.pid);
  }

  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command,
  };

  try {
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify(lockInfo, null, 2), {
      flag: 'wx',
    });
    logger.debug(`Acquired deployment lock (PID: ${process.pid})`);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      logger.error('Deployment already in progress (lock file already exists)');
      return false;
    }
    throw err;
  }
}
