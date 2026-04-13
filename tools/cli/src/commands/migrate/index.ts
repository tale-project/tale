import { Command } from 'commander';

import { migrateSplitConvex } from '../../lib/actions/migrate-split-convex';
import { requireProject } from '../../lib/project/find-project';
import { resolveProjectContext } from '../../lib/project/project-context';
import * as logger from '../../utils/logger';

export function createMigrateCommand(): Command {
  const cmd = new Command('migrate').description(
    'Data/volume migration helpers',
  );

  cmd
    .command('split-convex')
    .description(
      'One-shot migration: copy platform-data → convex-data (required when ' +
        'upgrading from the pre-split all-in-one architecture)',
    )
    .option('-f, --force', 'Skip confirmation prompt', false)
    .option('--dry-run', 'Print migration plan without making changes', false)
    .action(async (options) => {
      try {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const code = await migrateSplitConvex({
          force: options.force,
          dryRun: options.dryRun,
        });
        process.exit(code);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
