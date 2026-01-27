const LOCK_FILE = ".deployment-lock";

export function getLockFilePath(deployDir: string): string {
  return `${deployDir}/${LOCK_FILE}`;
}
