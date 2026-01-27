const STATE_FILE = ".deployment-color";

export function getStateFilePath(deployDir: string): string {
  return `${deployDir}/${STATE_FILE}`;
}
