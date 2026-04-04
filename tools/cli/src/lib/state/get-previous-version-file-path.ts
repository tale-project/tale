import { join } from 'node:path';

export function getPreviousVersionFilePath(deployDir: string): string {
  return join(deployDir, '.tale', 'deployment-previous-version');
}
