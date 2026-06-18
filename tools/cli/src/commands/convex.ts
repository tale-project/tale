import { Command } from 'commander';

import { convexAdmin } from '../lib/actions/convex-admin';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { action } from '../utils/run-command';

export function createConvexCommand(): Command {
  const convexCmd = new Command('convex').description(
    'Convex backend management',
  );

  convexCmd
    .command('admin')
    .description('Generate admin key for Convex dashboard access')
    .action(
      action(async () => {
        await resolveProjectContext(requireProject());
        await convexAdmin();
      }),
    );

  return convexCmd;
}
