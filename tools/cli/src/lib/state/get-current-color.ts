import type { DeploymentColor } from '../compose/types';

import * as logger from '../../utils/logger';
import { getStateFilePath } from './get-state-file-path';

export async function getCurrentColor(
  deployDir: string,
): Promise<DeploymentColor | null> {
  const statePath = getStateFilePath(deployDir);

  try {
    const content = await Bun.file(statePath).text();
    const color = content.trim() as DeploymentColor;

    if (color !== 'blue' && color !== 'green') {
      logger.warn(`Invalid color in state file: ${color}`);
      return null;
    }

    return color;
  } catch {
    return null;
  }
}
