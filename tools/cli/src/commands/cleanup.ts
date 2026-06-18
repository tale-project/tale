import { Command } from 'commander';

import { cleanup } from '../lib/actions/cleanup';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createCleanupCommand(): Command {
  return new Command('cleanup')
    .description('Remove inactive (non-current) color containers')
    .action(
      action(async () => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await cleanup({ env });
      }),
    );
}
