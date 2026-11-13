import { Command } from 'commander';

import { startEnvironment } from '../lib/actions/stop';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { selectRuntime } from '../lib/runtime/select-runtime';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createStartCommand(): Command {
  return new Command('start')
    .description(
      'Start the stopped environment again: data first, each tier healthy before the next',
    )
    .option('--dry-run', 'Print the order and start nothing', false)
    .action(
      action(async (options: { dryRun: boolean }) => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await startEnvironment({
          deployDir: env.DEPLOY_DIR,
          runtime: await selectRuntime(projectDir),
          healthTimeout: env.HEALTH_CHECK_TIMEOUT,
          dryRun: options.dryRun,
        });
      }),
    );
}
