import { Command, Option } from 'commander';

import { runDev, stopDev } from '../../lib/actions/dev';
import { resolveDevOrigin } from '../../lib/config/dev-origin';
import { usageError } from '../../utils/fail';
import { action } from '../../utils/run-command';

export function createDevCommand(): Command {
  return new Command('dev')
    .description('Run Tale locally with your project files (live-reloaded)')
    .option('-d, --detach', 'run in background')
    .addOption(
      new Option('--stop', 'stop this local stack, keeping its data').conflicts(
        ['detach', 'port', 'host'],
      ),
    )
    .option('-p, --port <port>', 'HTTPS port to expose', '443')
    .option(
      '--host <hostname>',
      'local HTTPS hostname or IP address',
      'localhost',
    )
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
          stop?: boolean;
          port: string;
          host: string;
          yes?: boolean;
        }) => {
          if (opts.stop) {
            await stopDev();
            return;
          }
          const port = Number(opts.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw usageError(`Invalid --port "${opts.port}": expected 1-65535`);
          }
          const origin = resolveDevOrigin(opts.host, port);
          await runDev({
            detach: opts.detach,
            port,
            host: origin.host,
            assumeYes: opts.yes,
          });
        },
      ),
    );
}
