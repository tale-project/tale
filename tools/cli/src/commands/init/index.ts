import { Command } from 'commander';

import { init } from '../../lib/actions/init';
import * as logger from '../../utils/logger';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize a new Tale project directory')
    .argument('[directory]', 'target directory (defaults to current directory)')
    .option('-f, --force', 'overwrite existing tale.json')
    .option('--no-env', 'skip .env setup')
    .action(
      async (
        directory: string | undefined,
        opts: { force?: boolean; env: boolean },
      ) => {
        try {
          await init({
            directory,
            force: opts.force,
            noEnv: !opts.env,
          });
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
