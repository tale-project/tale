import { join } from 'node:path';

export function getStateFilePath(deployDir: string): string {
  return join(deployDir, '.tale', 'deployment-color');
}
