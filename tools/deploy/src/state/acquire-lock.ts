import { existsSync } from "node:fs";
import * as logger from "../utils/logger";
import { getLockFilePath } from "./get-lock-file-path";
import { type LockInfo, getLockInfo } from "./get-lock-info";

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireLock(
  deployDir: string,
  command: string
): Promise<boolean> {
  const lockPath = getLockFilePath(deployDir);

  if (existsSync(lockPath)) {
    const existingLock = await getLockInfo(deployDir);
    if (existingLock) {
      const isRunning = await isProcessRunning(existingLock.pid);
      if (isRunning) {
        logger.error(
          `Deployment already in progress (PID: ${existingLock.pid}, started: ${existingLock.startedAt})`
        );
        return false;
      }
      logger.warn(`Removing stale lock from PID ${existingLock.pid}`);
    }
  }

  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command,
  };

  await Bun.write(lockPath, JSON.stringify(lockInfo, null, 2));
  logger.debug(`Acquired deployment lock (PID: ${process.pid})`);
  return true;
}
