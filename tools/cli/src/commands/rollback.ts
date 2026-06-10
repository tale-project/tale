import { Command } from 'commander';

import { rollback } from '../lib/actions/rollback';
import { ensureEnv } from '../lib/config/ensure-env';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createRollbackCommand(): Command {
  return new Command('rollback')
    .description(
      'Roll back to the previous version (patch-level rollbacks only — ' +
        'minor/major recovery goes through backup restore)',
    )
    .action(async () => {
      try {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const { success: envSetupSuccess } = await ensureEnv({
          deployDir: projectDir,
        });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        const env = loadEnv(projectDir);
        await rollback({ env });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
