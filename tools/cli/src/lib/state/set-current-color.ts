import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DeploymentColor } from '../compose/types';

import * as logger from '../../utils/logger';
import { getStateFilePath } from './get-state-file-path';

export async function setCurrentColor(
  deployDir: string,
  color: DeploymentColor,
): Promise<void> {
  const statePath = getStateFilePath(deployDir);
  await mkdir(dirname(statePath), { recursive: true });
  await Bun.write(statePath, color);
  logger.debug(`Set deployment color to: ${color}`);
}
