import { Command } from 'commander';

import { uninstall } from '../lib/actions/uninstall';
import { action } from '../utils/run-command';

export function createUninstallCommand(): Command {
  return new Command('uninstall')
    .description(
      'Remove the Tale CLI binary from this system (optionally purge the per-user config and a project)',
    )
    .option('-f, --force', 'skip the binary-removal confirmation', false)
    .option(
      '--purge',
      "also remove the per-user config (~/.tale-daemon) and tear down the current project's Docker resources + files",
      false,
    )
    .option(
      '--dry-run',
      'show what would be removed without removing anything',
      false,
    )
    .action(
      action(async (opts) => {
        await uninstall({
          force: opts.force,
          purge: opts.purge,
          dryRun: opts.dryRun,
        });
      }),
    );
}
