import { Command } from 'commander';

import { start } from '../../lib/actions/start';
import * as logger from '../../utils/logger';

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start Tale platform locally with project files')
    .option('-d, --detach', 'run in background')
    .option('-p, --port <port>', 'HTTPS port to expose', '443')
    .option('--host <hostname>', 'host alias for proxy', 'tale.local')
    .option(
      '--fresh',
      'force re-seed builtin agent/workflow/integration configs',
    )
    .option(
      '-y, --yes',
      'automatically accept any pending migrations (non-interactive; required in CI/non-TTY)',
    )
    .action(
      async (opts: {
        detach?: boolean;
        port: string;
        host: string;
        fresh?: boolean;
        yes?: boolean;
      }) => {
        try {
          await start({
            detach: opts.detach,
            port: Number(opts.port),
            host: opts.host,
            fresh: opts.fresh,
            assumeYes: opts.yes,
          });
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
