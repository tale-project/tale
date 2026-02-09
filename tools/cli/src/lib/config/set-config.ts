import { mkdir } from 'node:fs/promises';

import type { GlobalConfig } from './types';

import * as logger from '../../utils/logger';
import { getConfigDir, getConfigFilePath } from './get-config-file-path';

export async function setConfig(config: GlobalConfig): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigFilePath();

  await mkdir(configDir, { recursive: true });
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  logger.debug(`Saved config to: ${configPath}`);
}
