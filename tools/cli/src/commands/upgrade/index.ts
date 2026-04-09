import { Command, Option } from 'commander';

import { upgrade } from '../../lib/actions/upgrade';
import * as logger from '../../utils/logger';

export function createUpgradeCommand(): Command {
  return new Command('upgrade')
    .description('Upgrade CLI to the latest version and sync project files')
    .option(
      '-f, --force',
      'force re-download and overwrite locally modified files',
    )
    .option('--dry-run', 'show what would change without modifying anything')
    .addOption(
      new Option('--internal-sync-only', 'sync project files only').hideHelp(),
    )
    .action(
      async (opts: {
        force?: boolean;
        dryRun?: boolean;
        internalSyncOnly?: boolean;
      }) => {
        try {
          await upgrade({
            force: opts.force,
            dryRun: opts.dryRun,
            internalSyncOnly: opts.internalSyncOnly,
          });
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
