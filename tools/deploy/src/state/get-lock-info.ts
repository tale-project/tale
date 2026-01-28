import { getLockFilePath } from "./get-lock-file-path";

export interface LockInfo {
  pid: number;
  startedAt: string;
  command: string;
}

function isLockInfo(value: unknown): value is LockInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LockInfo).pid === "number" &&
    typeof (value as LockInfo).startedAt === "string" &&
    typeof (value as LockInfo).command === "string"
  );
}

export async function getLockInfo(deployDir: string): Promise<LockInfo | null> {
  const lockPath = getLockFilePath(deployDir);

  try {
    const content = await Bun.file(lockPath).text();
    const parsed: unknown = JSON.parse(content);
    return isLockInfo(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
