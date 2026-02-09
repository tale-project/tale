import { existsSync, readFileSync } from 'node:fs';

import { getConfigFilePath } from './get-config-file-path';
import { isGlobalConfig } from './types';

export function getDefaultDeployDir(): string | undefined {
  const configPath = getConfigFilePath();

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (isGlobalConfig(parsed)) {
        return parsed.deployDir;
      }
    }
  } catch {
    // Ignore errors, fall through to undefined
  }

  return undefined;
}
