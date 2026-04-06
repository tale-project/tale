import { Command } from 'commander';

import { status } from '../lib/actions/status';
import { requireProject } from '../lib/project/find-project';
import { loadEnv } from '../utils/load-env';
import * as logger from '../utils/logger';

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show current deployment status')
    .action(async () => {
      try {
        const projectDir = requireProject();
        const env = loadEnv(projectDir);
        await status({
          deployDir: env.DEPLOY_DIR,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
