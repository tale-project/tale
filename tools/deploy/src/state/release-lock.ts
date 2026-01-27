import { existsSync } from "node:fs";
import * as logger from "../utils/logger";
import { getLockFilePath } from "./get-lock-file-path";
import { getLockInfo } from "./get-lock-info";

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
