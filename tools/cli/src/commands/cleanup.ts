import { Command } from 'commander';

import { cleanup } from '../lib/actions/cleanup';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createCleanupCommand(): Command {
  return new Command('cleanup')
    .description('Remove inactive (non-current) color containers')
    .action(async () => {
      try {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await cleanup({ env });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
