import { join } from 'node:path';

export function getFlipPendingFilePath(deployDir: string): string {
  return join(deployDir, '.tale', 'deployment-flip-pending');
}
