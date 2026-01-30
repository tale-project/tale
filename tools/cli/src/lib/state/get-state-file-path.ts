import { join } from "node:path";

const STATE_FILE = ".deployment-color";

export function getStateFilePath(deployDir: string): string {
  return join(deployDir, STATE_FILE);
}
