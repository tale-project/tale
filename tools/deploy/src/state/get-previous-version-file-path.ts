const PREVIOUS_VERSION_FILE = ".deployment-previous-version";

export function getPreviousVersionFilePath(deployDir: string): string {
  return `${deployDir}/${PREVIOUS_VERSION_FILE}`;
}
