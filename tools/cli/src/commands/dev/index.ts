import { Command, Option } from 'commander';

import { runDev } from '../../lib/actions/dev';
import { usageError } from '../../utils/fail';
import { action } from '../../utils/run-command';

export function createDevCommand(): Command {
  return new Command('dev')
    .description('Run Tale locally with your project files (live-reloaded)')
    .option('-d, --detach', 'run in background')
    .option('-p, --port <port>', 'HTTPS port to expose', '443')
    .option('--host <hostname>', 'host alias for proxy', 'tale.local')
    .addOption(
      new Option(
        '-y, --yes',
        'non-interactive: auto-accept prompts (e.g. installing/starting Docker)',
      ),
    )
    .action(
      action(
        async (opts: {
          detach?: boolean;
          port: string;
          host: string;
          yes?: boolean;
        }) => {
          const port = Number(opts.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw usageError(`Invalid --port "${opts.port}": expected 1-65535`);
          }
          await runDev({
            detach: opts.detach,
            port,
            host: opts.host,
            assumeYes: opts.yes,
          });
        },
      ),
    );
}
