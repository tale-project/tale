import { Command } from 'commander';

import { reset } from '../lib/actions/reset';
import { ensureEnv } from '../lib/config/ensure-env';
import { requireProject } from '../lib/project/find-project';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createResetCommand(): Command {
  return new Command('reset')
    .description('Remove ALL blue-green containers')
    .option('-f, --force', 'Skip confirmation prompt', false)
    .option('-a, --all', 'Also remove infrastructure (db, proxy)', false)
    .option('--dry-run', 'Preview reset without making changes', false)
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
        await reset({
          env,
          force: options.force,
          includeStateful: options.all,
          dryRun: options.dryRun,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
