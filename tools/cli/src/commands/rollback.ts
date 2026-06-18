import { Command } from 'commander';

import { rollback } from '../lib/actions/rollback';
import { ensureEnv } from '../lib/config/ensure-env';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { preconditionError } from '../utils/fail';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createRollbackCommand(): Command {
  return new Command('rollback')
    .description(
      'Roll back to the previous version (patch-level rollbacks only — ' +
        'minor/major recovery goes through backup restore)',
    )
    .action(
      action(async () => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const { success: envSetupSuccess } = await ensureEnv({
          deployDir: projectDir,
        });
        if (!envSetupSuccess) {
          throw preconditionError(
            `Environment setup failed. Cannot roll back without ${projectDir}/.env.`,
          );
        }
        const env = loadEnv(projectDir);
        await rollback({ env });
      }),
    );
}
