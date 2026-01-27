import { existsSync } from "node:fs";
import { getLockFilePath } from "./get-lock-file-path";

export interface LockInfo {
  pid: number;
  startedAt: string;
  command: string;
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
