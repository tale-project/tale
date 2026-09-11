import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Command } from 'commander';

import { sha256 } from '../../lib/config/releases/identity';
import { withFrozenDeployment } from '../../lib/deployment/bundle';
import { observeManagedInference } from '../../lib/deployment/inference-apply';
import { CliError, preconditionError, usageError } from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { action } from '../../utils/run-command';
import { assertManagedOptions } from './options';

export function createInferenceStatusCommand(): Command {
  return new Command('inference-status')
    .description(
      'Observe the verified private inference namespace for fleet enrollment',
    )
    .option('--bundle <directory>', 'Prepared Tale deployment bundle')
    .option('--cli-ref <sha>', 'Expected Tale CLI source commit')
    .option('--deployment-ref <sha>', 'Expected orchestrator commit')
    .action(
      action(
        async (
          options: { bundle?: string; cliRef?: string; deploymentRef?: string },
          command: Command,
        ) => {
          assertManagedOptions(command, ['bundle', 'cliRef', 'deploymentRef']);
          const selected =
            options.bundle ?? command.parent?.getOptionValue('bundle');
          if (!selected) throw usageError('--bundle must name a directory.');
          const expected = {
            cliRef: options.cliRef ?? command.parent?.getOptionValue('cliRef'),
            deploymentRef:
              options.deploymentRef ??
              command.parent?.getOptionValue('deploymentRef'),
          };
          let result;
          try {
            result = await withFrozenDeployment(
              selected,
              expected,
              async (directory, bundle) => ({
                ...(await observeManagedInference(
                  join(directory, 'inference'),
                  bundle.spec,
                )),
                bundleSha256: sha256(
                  await readFile(join(directory, 'deployment.json')),
                ),
                cliRef: bundle.cli.revision,
                ...(bundle.deploymentRef
                  ? { deploymentRef: bundle.deploymentRef }
                  : {}),
              }),
            );
          } catch (error) {
            if (error instanceof CliError) throw error;
            throw preconditionError(
              'Inference namespace could not be observed. Check the exact bundle and retained private deployment state.',
            );
          }
          if (getOutputMode().json) emitJson('deploy inference-status', result);
          else logger.info(JSON.stringify(result, null, 2));
        },
      ),
    );
}
