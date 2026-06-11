import { Command, Option } from 'commander';

import { start } from '../../lib/actions/start';
import * as logger from '../../utils/logger';

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start Tale platform locally with project files')
    .option('-d, --detach', 'run in background')
    .option('-p, --port <port>', 'HTTPS port to expose', '443')
    .option('--host <hostname>', 'host alias for proxy', 'tale.local')
    .addOption(
      new Option(
        '-y, --yes',
        'non-interactive: auto-accept the legacy config-layout migration when detected',
      ),
    )
    .addOption(
      new Option(
        '--skip-backup',
        'skip the volume snapshot taken before the legacy config-layout migration',
      ),
    )
    .action(
      async (opts: {
        detach?: boolean;
        port: string;
        host: string;
        yes?: boolean;
        skipBackup?: boolean;
      }) => {
        try {
          await start({
            detach: opts.detach,
            port: Number(opts.port),
            host: opts.host,
            assumeYes: opts.yes,
            skipBackup: opts.skipBackup,
          });
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
