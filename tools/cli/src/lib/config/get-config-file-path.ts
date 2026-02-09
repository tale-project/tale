import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = '.tale';
const CONFIG_FILE = 'config.json';

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), CONFIG_FILE);
}
