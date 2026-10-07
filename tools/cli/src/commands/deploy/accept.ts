import { Command } from 'commander';

import {
  acceptDeployment,
  type AcceptDeploymentOptions,
} from '../../lib/deployment/acceptance';
import { usageError } from '../../utils/fail';
import { action } from '../../utils/run-command';
import { managedResult } from './managed';
import { assertManagedOptions } from './options';

export function createAcceptCommand(): Command {
  return new Command('accept')
    .description(
      "Read current runtime, image and migration proof for an exact ready deployment, plus the origin's reported version",
    )
    .option('--bundle <directory>', 'Prepared Tale deployment bundle')
    .option('--cli-ref <sha>', 'Expected full CLI source commit')
    .option('--deployment-ref <sha>', 'Expected full orchestrator commit')
    .requiredOption(
      '--expected-version <version>',
      'Expected stable release version, also verified from runtime image labels',
    )
    .action(
      action(
        async (options: Partial<AcceptDeploymentOptions>, command: Command) => {
          assertManagedOptions(command, ['bundle', 'cliRef', 'deploymentRef']);
          const selected = {
            ...options,
            bundle: options.bundle ?? command.parent?.getOptionValue('bundle'),
            cliRef: options.cliRef ?? command.parent?.getOptionValue('cliRef'),
            deploymentRef:
              options.deploymentRef ??
              command.parent?.getOptionValue('deploymentRef'),
          };
          if (
            !selected.bundle ||
            !selected.cliRef ||
            !selected.deploymentRef ||
            !selected.expectedVersion
          )
            throw usageError(
              'deploy accept requires --bundle, --cli-ref, --deployment-ref and --expected-version.',
            );
          await managedResult('deploy accept', () =>
            acceptDeployment(selected as AcceptDeploymentOptions),
          );
        },
      ),
    );
}
