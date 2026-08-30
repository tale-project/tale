import { Command } from 'commander';

import { runDeploy } from '../../lib/actions/run-deploy';
import { ALL_SERVICES, STOP_GATED_SERVICES } from '../../lib/compose/types';
import { action } from '../../utils/run-command';

export function createDeployCommand(): Command {
  return new Command('deploy')
    .description('Deploy the current CLI version to the environment')
    .option(
      '--stop',
      `Also update the stop-gated tier (${STOP_GATED_SERVICES.join(', ')}) — recreates them, so accepts a brief downtime. Without it, running ${STOP_GATED_SERVICES.join('/')} are left untouched.`,
      false,
    )
    .option(
      '-s, --services <list>',
      `Specific services to update (comma-separated: ${ALL_SERVICES.join(',')})`,
    )
    .option('--dry-run', 'Preview deployment without making changes', false)
    .option('--host <hostname>', 'Host alias for proxy')
    .option(
      '--override',
      'overwrite container config from the host workspace. Without --override, host config files are NOT pushed (the container keeps its current config). With --override, the host workspace overwrites container config, except encrypted *.secrets.json files and .history/ directories, which are always preserved',
    )
    .option('-q, --quiet', 'Suppress container logs during deployment')
    .option(
      '--override-all',
      'After deploy, factory-reseed the builtin catalog into ALL orgs server-side ' +
        '(preserves *.secrets.json, .history/, and uploaded branding/images/). ' +
        'Implies --stop (recreates stateful services so the new entrypoint runs).',
      false,
    )
    .option(
      '-y, --yes',
      'Non-interactive: auto-accept destructive confirmation prompts (e.g. --override-all)',
      false,
    )
    .option(
      '--skip-backup',
      'Skip the automatic pre-deploy volume snapshot (recovery from a failed ' +
        'migration then falls back to your own external backups)',
      false,
    )
    .option(
      '--accept-data-loss',
      'Expert override for the breaking-cutover guard: deploy a >= 0.5 ' +
        'CLI over a pre-0.5 instance although its data becomes permanently ' +
        'unreadable. Normally you want a fresh deployment instead.',
      false,
    )
    .action(
      action(async (options) => {
        await runDeploy({
          stop: options.stop,
          services: options.services,
          dryRun: options.dryRun,
          host: options.host,
          override: options.override,
          overrideAll: options.overrideAll,
          quiet: options.quiet,
          yes: options.yes,
          skipBackup: options.skipBackup,
          acceptDataLoss: options.acceptDataLoss,
        });
      }),
    );
}
