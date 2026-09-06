import { Command } from 'commander';

import { reset } from '../lib/actions/reset';
import { SIDECAR_SERVICES, STATEFUL_SERVICES } from '../lib/compose/types';
import { ensureEnv } from '../lib/config/ensure-env';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { preconditionError } from '../utils/fail';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createResetCommand(): Command {
  return new Command('reset')
    .description('Remove ALL blue-green containers')
    .option('-f, --force', 'Skip confirmation prompt', false)
    .option(
      '-a, --all',
      `Also remove infrastructure (${[...STATEFUL_SERVICES, ...SIDECAR_SERVICES].join(', ')})`,
      false,
    )
    .option('--dry-run', 'Preview reset without making changes', false)
    .action(
      action(async (options) => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const { success: envSetupSuccess } = await ensureEnv({
          deployDir: projectDir,
        });
        if (!envSetupSuccess) {
          throw preconditionError(
            `Environment setup failed. Cannot reset without ${projectDir}/.env.`,
          );
        }
        const env = loadEnv(projectDir);
        await reset({
          env,
          force: options.force,
          includeStateful: options.all,
          dryRun: options.dryRun,
        });
      }),
    );
}
