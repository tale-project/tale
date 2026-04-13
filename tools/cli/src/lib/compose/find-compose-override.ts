import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as logger from '../../utils/logger';

/**
 * Check the project directory for a Docker Compose override file.
 *
 * Users can drop `compose.override.yml` (or `.yaml`) in their project root
 * to customize the generated compose config. This is currently dev-only
 * (tale start) — prod deploys ignore it because service names differ.
 *
 * Returns the absolute path to the override file, or null if none exists.
 * When both extensions are present, prefers `.yml` and warns about the ignored `.yaml`.
 */
export function findComposeOverride(projectDir: string): string | null {
  const ymlPath = join(projectDir, 'compose.override.yml');
  const yamlPath = join(projectDir, 'compose.override.yaml');
  const ymlExists = existsSync(ymlPath);
  const yamlExists = existsSync(yamlPath);

  if (ymlExists && yamlExists) {
    logger.warn(
      'Both compose.override.yml and compose.override.yaml exist. Using .yml and ignoring .yaml.',
    );
    return ymlPath;
  }
  if (ymlExists) return ymlPath;
  if (yamlExists) return yamlPath;
  return null;
}
