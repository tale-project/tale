import { Command, Option } from 'commander';

import { runUpdate } from '../../lib/actions/run-update';
import { action } from '../../utils/run-command';

export function createUpdateCommand(): Command {
  return (
    new Command('update')
      .description(
        'Update this Tale instance: move the CLI to a new version within its current x.y release line and sync project files (run `tale deploy` afterwards to roll the containers)',
      )
      .option(
        '-v, --version <version>',
        'update to this exact version (e.g. 0.9.0) instead of the latest release in the current x.y line; required to change release lines; allows downgrades',
      )
      .option(
        '-f, --force',
        'force re-sync and overwrite locally modified project files',
      )
      .option('--dry-run', 'show what would change without modifying anything')
      // Hidden continuation: run only the file-sync phase under the binary that
      // the parent invocation just installed. Internal use — do not call directly.
      .addOption(
        new Option('--internal-instance', 'file-sync phase only').hideHelp(),
      )
      .action(
        action(async (opts) => {
          await runUpdate({
            version: opts.version,
            force: opts.force,
            dryRun: opts.dryRun,
            internalInstance: opts.internalInstance,
          });
        }),
      )
  );
}
