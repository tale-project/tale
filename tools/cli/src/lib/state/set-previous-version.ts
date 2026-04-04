import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import * as logger from '../../utils/logger';
import { getPreviousVersionFilePath } from './get-previous-version-file-path';

export async function setPreviousVersion(
  deployDir: string,
  version: string,
): Promise<void> {
  const versionPath = getPreviousVersionFilePath(deployDir);
  await mkdir(dirname(versionPath), { recursive: true });
  await Bun.write(versionPath, version);
  logger.debug(`Saved previous version: ${version}`);
}
