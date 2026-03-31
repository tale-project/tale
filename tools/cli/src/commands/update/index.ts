import { Command } from 'commander';

import { update } from '../../lib/actions/update';
import * as logger from '../../utils/logger';

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update project files to match current CLI version')
    .option('-f, --force', 'overwrite locally modified files')
    .option('--dry-run', 'show what would change without modifying files')
    .action(async (opts: { force?: boolean; dryRun?: boolean }) => {
      try {
        await update({
          force: opts.force,
          dryRun: opts.dryRun,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
