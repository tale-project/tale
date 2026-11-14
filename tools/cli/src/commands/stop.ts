import { Command } from 'commander';

import { stopEnvironment } from '../lib/actions/stop';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { selectRuntime } from '../lib/runtime/select-runtime';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createStopCommand(): Command {
  return new Command('stop')
    .description(
      'Stop the whole environment gracefully: the edge and both colours first, then the middle tier, then data',
    )
    .option('--dry-run', 'Print the order and stop nothing', false)
    .action(
      action(async (options: { dryRun: boolean }) => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await stopEnvironment({
          deployDir: env.DEPLOY_DIR,
          runtime: await selectRuntime(projectDir),
          dryRun: options.dryRun,
        });
      }),
    );
}
