import { join } from "node:path";

const PREVIOUS_VERSION_FILE = ".deployment-previous-version";

export function getPreviousVersionFilePath(deployDir: string): string {
  return join(deployDir, PREVIOUS_VERSION_FILE);
}
