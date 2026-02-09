export interface GlobalConfig {
  deployDir: string;
  configVersion: number;
}

export function isGlobalConfig(value: unknown): value is GlobalConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.deployDir === 'string' && typeof obj.configVersion === 'number'
  );
}

export const CURRENT_CONFIG_VERSION = 1;
