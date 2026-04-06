import { Command } from 'commander';

import { rollback } from '../lib/actions/rollback';
import { ensureEnv } from '../lib/config/ensure-env';
import { requireProject } from '../lib/project/find-project';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createRollbackCommand(): Command {
  return new Command('rollback')
    .description('Rollback to the previous version or a specific version')
    .option(
      '-v, --version <version>',
      'Specific version to rollback to (e.g., v1.0.0)',
    )
    .action(async (options) => {
      try {
        const projectDir = requireProject();
        const { success: envSetupSuccess } = await ensureEnv({
          deployDir: projectDir,
        });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        const env = loadEnv(projectDir);
        await rollback({ env, version: options.version });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
