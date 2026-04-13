import { Command } from 'commander';

import { convexAdmin } from '../lib/actions/convex-admin';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import * as logger from '../utils/logger';

export function createConvexCommand(): Command {
  const convexCmd = new Command('convex').description(
    'Convex backend management',
  );

  convexCmd
    .command('admin')
    .description('Generate admin key for Convex dashboard access')
    .action(async () => {
      try {
        await resolveProjectContext(requireProject());
        await convexAdmin();
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return convexCmd;
}
