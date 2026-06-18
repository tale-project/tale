import { Command } from 'commander';

import { init } from '../../lib/actions/init';
import { action } from '../../utils/run-command';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize a new Tale project directory')
    .argument('[directory]', 'target directory (defaults to current directory)')
    .option('-f, --force', 'overwrite existing tale.json')
    .option('--no-env', 'skip .env setup')
    .action(
      action(
        async (
          directory: string | undefined,
          opts: { force?: boolean; env: boolean },
        ) => {
          await init({
            directory,
            force: opts.force,
            noEnv: !opts.env,
          });
        },
      ),
    );
}
