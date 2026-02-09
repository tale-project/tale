import { Command } from 'commander';

import { convexAdmin } from '../lib/actions/convex-admin';
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
        await convexAdmin();
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return convexCmd;
}
