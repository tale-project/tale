import { Command } from 'commander';

import { logs } from '../lib/actions/logs';
import { ALL_SERVICES, SIDECAR_SERVICES } from '../lib/compose/types';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { usageError } from '../utils/fail';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

export function createLogsCommand(): Command {
  return new Command('logs')
    .description('View logs from a service')
    .argument(
      '<service>',
      `Service name (${[...ALL_SERVICES, ...SIDECAR_SERVICES].join(', ')})`,
    )
    .option('-c, --color <color>', 'Deployment color (blue or green)')
    .option('-f, --follow', 'Follow log output', false)
    .option('--since <duration>', 'Show logs since duration (e.g., 1h, 30m)')
    .option('-n, --tail <lines>', 'Number of lines to show from end')
    .option(
      '--raw',
      'Stream raw, unfiltered log output (no classification)',
      false,
    )
    .action(
      action(async (service: string, options) => {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);

        if (
          options.color &&
          options.color !== 'blue' &&
          options.color !== 'green'
        ) {
          throw usageError(
            `Invalid color: ${options.color}. Must be "blue" or "green".`,
          );
        }

        let tail: number | undefined;
        if (options.tail) {
          tail = parseInt(options.tail, 10);
          if (Number.isNaN(tail) || tail < 0) {
            throw usageError(
              `Invalid --tail value: ${options.tail}. Must be a non-negative number.`,
            );
          }
        }

        await logs({
          service,
          color: options.color,
          follow: options.follow,
          since: options.since,
          tail,
          raw: options.raw,
          deployDir: env.DEPLOY_DIR,
        });
      }),
    );
}
