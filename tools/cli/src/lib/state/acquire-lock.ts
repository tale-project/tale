import { mkdir, unlink, writeFile } from "node:fs/promises";
import * as logger from "../../utils/logger";
import { getLockFilePath } from "./get-lock-file-path";
import { type LockInfo, getLockInfo } from "./get-lock-info";

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      return true;
    }
    return false;
  }
}

export async function acquireLock(
  deployDir: string,
  command: string
): Promise<boolean> {
  const lockPath = getLockFilePath(deployDir);

  const existingLock = await getLockInfo(deployDir);
  if (existingLock) {
    const isRunning = isProcessRunning(existingLock.pid);
    if (isRunning) {
      logger.error(
        `Deployment already in progress (PID: ${existingLock.pid}, started: ${existingLock.startedAt})`
      );
      return false;
    }
    logger.warn(`Removing stale lock from PID ${existingLock.pid}`);
    try {
      await unlink(lockPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command,
  };

  try {
    await mkdir(deployDir, { recursive: true });
    await writeFile(lockPath, JSON.stringify(lockInfo, null, 2), { flag: "wx" });
    logger.debug(`Acquired deployment lock (PID: ${process.pid})`);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      logger.error("Deployment already in progress (lock file already exists)");
      return false;
    }
    throw err;
  }
}
