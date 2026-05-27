import { Command, Option } from 'commander';

import { start } from '../../lib/actions/start';
import * as logger from '../../utils/logger';

export function createStartCommand(): Command {
  return (
    new Command('start')
      .description('Start Tale platform locally with project files')
      .option('-d, --detach', 'run in background')
      .option('-p, --port <port>', 'HTTPS port to expose', '443')
      .option('--host <hostname>', 'host alias for proxy', 'tale.local')
      // Hidden back-compat: `tale start -y` used to skip migration prompts.
      // The auto-migration framework is gone but operator CI scripts may
      // still pass `-y`. Accept and ignore for one release, then remove.
      .addOption(
        new Option(
          '-y, --yes',
          '[deprecated] no longer needed (auto-migrations removed); ignored',
        ).hideHelp(),
      )
      .action(
        async (opts: {
          detach?: boolean;
          port: string;
          host: string;
          yes?: boolean;
        }) => {
          try {
            if (opts.yes) {
              logger.warn(
                '--yes/-y is deprecated on `tale start` and ignored; safe to remove from scripts.',
              );
            }
            await start({
              detach: opts.detach,
              port: Number(opts.port),
              host: opts.host,
            });
          } catch (err) {
            logger.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        },
      )
  );
}
