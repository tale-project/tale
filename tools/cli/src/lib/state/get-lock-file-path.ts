import { join } from 'node:path';

export function getLockFilePath(deployDir: string): string {
  return join(deployDir, '.tale', 'deployment-lock');
}
