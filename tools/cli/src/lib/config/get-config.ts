import { getConfigFilePath } from './get-config-file-path';
import { type GlobalConfig, isGlobalConfig } from './types';

export async function getConfig(): Promise<GlobalConfig | null> {
  const configPath = getConfigFilePath();

  try {
    const content = await Bun.file(configPath).text();
    const parsed: unknown = JSON.parse(content);
    return isGlobalConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
