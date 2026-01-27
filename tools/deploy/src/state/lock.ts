import { existsSync } from "node:fs";
import * as logger from "../utils/logger";

const LOCK_FILE = ".deployment-lock";

export function getLockFilePath(deployDir: string): string {
  return `${deployDir}/${LOCK_FILE}`;
}

export interface LockInfo {
  pid: number;
  startedAt: string;
  command: string;
}

export async function acquireLock(
  deployDir: string,
  command: string
): Promise<boolean> {
  const lockPath = getLockFilePath(deployDir);

  if (existsSync(lockPath)) {
    const existingLock = await getLockInfo(deployDir);
    if (existingLock) {
      // Check if the process is still running
      const isRunning = await isProcessRunning(existingLock.pid);
      if (isRunning) {
        logger.error(
          `Deployment already in progress (PID: ${existingLock.pid}, started: ${existingLock.startedAt})`
        );
        return false;
      }
      // Stale lock, remove it
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

export async function releaseLock(deployDir: string): Promise<void> {
  const lockPath = getLockFilePath(deployDir);

  if (!existsSync(lockPath)) {
    return;
  }

  const lockInfo = await getLockInfo(deployDir);
  if (lockInfo && lockInfo.pid === process.pid) {
    const { unlink } = await import("node:fs/promises");
    await unlink(lockPath);
    logger.debug("Released deployment lock");
  }
}

export async function getLockInfo(deployDir: string): Promise<LockInfo | null> {
  const lockPath = getLockFilePath(deployDir);

  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const content = await Bun.file(lockPath).text();
    return JSON.parse(content) as LockInfo;
  } catch {
    return null;
  }
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function withLock<T>(
  deployDir: string,
  command: string,
  fn: () => Promise<T>
): Promise<T> {
  const acquired = await acquireLock(deployDir, command);
  if (!acquired) {
    throw new Error("Failed to acquire deployment lock");
  }

  try {
    return await fn();
  } finally {
    await releaseLock(deployDir);
  }
}
