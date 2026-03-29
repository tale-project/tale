import { Command } from 'commander';

import { start } from '../../lib/actions/start';
import * as logger from '../../utils/logger';

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start Tale platform locally with project files')
    .argument('[version]', 'image version to use (default: latest)')
    .option('-d, --detach', 'run in background')
    .option('--host <hostname>', 'host alias for proxy', 'tale.local')
    .action(
      async (
        version: string | undefined,
        opts: { detach?: boolean; host: string },
      ) => {
        try {
          await start({
            version,
            detach: opts.detach,
            host: opts.host,
          });
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
