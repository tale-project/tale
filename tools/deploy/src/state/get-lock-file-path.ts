import { join } from "node:path";

const LOCK_FILE = ".deployment-lock";

export function getLockFilePath(deployDir: string): string {
  return join(deployDir, LOCK_FILE);
}
