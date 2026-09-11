import { Command } from 'commander';
import { z } from 'zod';

import {
  applyDeployment,
  type ApplyDeploymentOptions,
} from '../../lib/deployment/apply';
import { verifyDeploymentBundle } from '../../lib/deployment/bundle';
import {
  prepareDeployment,
  type PrepareDeploymentOptions,
} from '../../lib/deployment/prepare';
import { CliError, preconditionError, usageError } from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode, resolveConsent } from '../../utils/output-mode';
import { confirm, NonInteractiveError } from '../../utils/prompt';
import { action } from '../../utils/run-command';
import { assertManagedOptions, assertManagedPlatform } from './options';

export async function managedResult(
  command: string,
  work: () => Promise<unknown>,
): Promise<void> {
  let result;
  try {
    result = await work();
  } catch (error) {
    if (error instanceof CliError || error instanceof NonInteractiveError)
      throw error;
    if (error instanceof z.ZodError)
      throw preconditionError('Deployment input does not match its schema.');
    throw preconditionError(
      'Deployment failed. Review the source pins, paths, permissions and retained recovery receipts.',
    );
  }
  if (getOutputMode().json) emitJson(command, result);
  else {
    logger.success(`${command} completed.`);
    logger.info(JSON.stringify(result, null, 2));
  }
}

export function createPrepareCommand(): Command {
  return new Command('prepare')
    .description(
      'Prepare a verified runtime and configuration bundle from exact source commits',
    )
    .requiredOption(
      '--spec <file>',
      'Declarative Tale destination and source pins',
    )
    .requiredOption('--output <directory>', 'New deployment bundle directory')
    .option(
      '--deployment-ref <sha>',
      'Optional orchestrator commit for the deployment receipt',
    )
    .option(
      '--sources-file <file>',
      'Optional repository@fullSHA to local checkout mapping',
    )
    .action(
      action(async (options: PrepareDeploymentOptions, command: Command) => {
        assertManagedOptions(command, ['deploymentRef']);
        await managedResult('deploy prepare', () =>
          prepareDeployment({
            ...options,
            deploymentRef:
              options.deploymentRef ??
              command.parent?.getOptionValue('deploymentRef'),
          }),
        );
      }),
    );
}

export function createVerifyBundleCommand(): Command {
  return new Command('verify-bundle')
    .description(
      'Verify every file in a prepared deployment bundle without contacting a destination',
    )
    .option('--bundle <directory>', 'Prepared Tale deployment bundle')
    .option('--cli-ref <sha>', 'Expected Tale CLI source commit')
    .option('--deployment-ref <sha>', 'Expected orchestrator commit')
    .action(
      action(
        async (options: Partial<ApplyDeploymentOptions>, command: Command) => {
          assertManagedOptions(command, ['bundle', 'cliRef', 'deploymentRef']);
          // Commander allows deploy options on either side of a child command.
          // Read only the shared options explicitly; global defaults must not
          // overwrite a value already parsed by the parent deploy command.
          const bundle =
            options.bundle ?? command.parent?.getOptionValue('bundle');
          if (!bundle) throw usageError('--bundle is required.');
          const expected = {
            cliRef: options.cliRef ?? command.parent?.getOptionValue('cliRef'),
            deploymentRef:
              options.deploymentRef ??
              command.parent?.getOptionValue('deploymentRef'),
          };
          await managedResult('deploy verify-bundle', () =>
            verifyDeploymentBundle(bundle, expected),
          );
        },
      ),
    );
}

export async function runManagedDeployment(
  options: ApplyDeploymentOptions & { yes?: boolean },
): Promise<void> {
  await managedResult('deploy', async () => {
    assertManagedPlatform();
    if (
      !options.dryRun &&
      !resolveConsent(options.yes) &&
      !(await confirm({
        message: 'Deploy the selected Tale bundle?',
        default: false,
      }))
    )
      throw new NonInteractiveError('Deployment was not confirmed.');
    return applyDeployment(options);
  });
}
