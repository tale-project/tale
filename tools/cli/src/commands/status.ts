import { Command } from 'commander';

import { status } from '../lib/actions/status';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import { getOutputMode } from '../utils/output-mode';
import { action } from '../utils/run-command';

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show current deployment status')
    .action(
      action(async () => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        await status({ deployDir: env.DEPLOY_DIR, json: getOutputMode().json });
      }),
    );
}
