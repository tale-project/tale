import { Command } from 'commander';

import { runDeploy } from '../../lib/actions/run-deploy';
import { ALL_SERVICES, STOP_GATED_SERVICES } from '../../lib/compose/types';
import { usageError } from '../../utils/fail';
import { action } from '../../utils/run-command';
import {
  createExportClientCommand,
  createNativeExportClientCommand,
} from './export-client';
import {
  createPrepareCommand,
  createVerifyBundleCommand,
  runManagedDeployment,
} from './managed';
import { createProvisionCommand } from './provision';

export function createDeployCommand(): Command {
  return new Command('deploy')
    .description(
      'Deploy the current CLI version or a verified deployment bundle',
    )
    .option('--bundle <directory>', 'Apply a prepared Tale deployment bundle')
    .option('--cli-ref <sha>', 'Expected bundle CLI source commit')
    .option('--deployment-ref <sha>', 'Expected bundle orchestrator commit')
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
    .addCommand(createPrepareCommand())
    .addCommand(createVerifyBundleCommand())
    .addCommand(createProvisionCommand())
    .addCommand(createExportClientCommand())
    .addCommand(createNativeExportClientCommand(), { hidden: true })
    .action(
      action(async (options) => {
        if (options.bundle !== undefined) {
          if (!options.bundle)
            throw usageError('--bundle must name a directory.');
          if (
            options.stop ||
            options.services ||
            options.host ||
            options.override ||
            options.overrideAll ||
            options.skipBackup ||
            options.acceptDataLoss
          )
            throw usageError(
              'Bundle deployments cannot use workspace deployment flags. Review the bundle specification instead.',
            );
          await runManagedDeployment({
            bundle: options.bundle,
            cliRef: options.cliRef,
            deploymentRef: options.deploymentRef,
            dryRun: options.dryRun,
            yes: options.yes,
          });
          return;
        }
        if (options.cliRef !== undefined || options.deploymentRef !== undefined)
          throw usageError('--cli-ref and --deployment-ref require --bundle.');
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
