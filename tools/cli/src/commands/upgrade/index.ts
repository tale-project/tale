import { Command, Option } from 'commander';

import { upgrade } from '../../lib/actions/upgrade';
import * as logger from '../../utils/logger';

export function createUpgradeCommand(): Command {
  return new Command('upgrade')
    .alias('update')
    .description(
      'Upgrade or migrate the CLI to a specific version, then sync project files',
    )
    .option(
      '-v, --version <version>',
      'install this exact version (e.g. 0.9.0) instead of the latest release; allows downgrades',
    )
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
        version?: string;
        force?: boolean;
        dryRun?: boolean;
        internalSyncOnly?: boolean;
      }) => {
        try {
          await upgrade({
            version: opts.version,
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
