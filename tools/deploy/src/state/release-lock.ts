import { unlink } from "node:fs/promises";
import * as logger from "../utils/logger";
import { getLockFilePath } from "./get-lock-file-path";
import { getLockInfo } from "./get-lock-info";

export async function releaseLock(deployDir: string): Promise<void> {
  const lockPath = getLockFilePath(deployDir);

  try {
    const lockInfo = await getLockInfo(deployDir);

    if (lockInfo && lockInfo.pid !== process.pid) {
      return;
    }

    // Remove lock if it's ours or if it's corrupt (lockInfo is null but file exists)
    await unlink(lockPath);
    logger.debug("Released deployment lock");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`Failed to release lock: ${err}`);
    }
  }
}
