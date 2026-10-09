import { Command } from 'commander';

import {
  observeDeployment,
  type ObserveDeploymentOptions,
} from '../../lib/deployment/observation';
import { ObservationCleanupError } from '../../lib/deployment/observation-errors';
import { observationFile } from '../../lib/deployment/observation-files';
import { nativeObservationInputSchema } from '../../lib/deployment/observation-model';
import { observeNativeDeployment } from '../../lib/deployment/observation-native';
import { preconditionError, usageError } from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import { getOutputMode } from '../../utils/output-mode';
import { readPrivateText } from '../../utils/private-input';
import { action } from '../../utils/run-command';
import { assertManagedOptions } from './options';

export async function observationInput(
  source: AsyncIterable<unknown>,
  timeoutMs = 10_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return JSON.parse(
      await Promise.race([
        readPrivateText(source, 65536, {
          invalid: 'Observation input must be UTF-8 JSON.',
          oversized: 'Observation input exceeds 64 KiB.',
          unreadable: 'Observation input is unreadable.',
          encoding: 'Observation input must be UTF-8 JSON.',
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            if (source === process.stdin) process.stdin.destroy();
            reject(Error('input deadline'));
          }, timeoutMs);
        }),
      ]),
    );
  } catch {
    throw usageError(
      'Observation input is invalid, exceeds 64 KiB or timed out.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Do not pass schema values, filesystem paths, native responses or command
 * stderr through the global renderer. Private-input failures have one surface. */
export async function observationBoundary<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ObservationCleanupError) throw error;
    throw preconditionError(
      'Deployment observation refused invalid input, unsafe custody, changed identity or incomplete verification. No deployment was performed.',
    );
  }
}

function requireJson() {
  if (!getOutputMode().json)
    throw usageError('Deployment observation requires --json.');
  if (process.stdin.isTTY)
    throw usageError('Provide the bounded private observation input on stdin.');
}

export function writeObservationResult(
  command: 'deploy observe' | 'deploy observe-native',
  data: unknown,
  complete: boolean,
): void {
  emitJson(command, data, complete);
  process.exitCode = complete ? 0 : 3;
}

export function createObserveCommand(): Command {
  return new Command('observe')
    .description(
      'Observe an existing deployment without applying configuration or accepting a release',
    )
    .requiredOption('--spec <file>', 'Reviewed deployment specification JSON')
    .option('--cli-ref <sha>', 'Expected full CLI source commit')
    .option('--deployment-ref <sha>', 'Expected full orchestrator commit')
    .requiredOption(
      '--machine-id-sha256 <digest>',
      'Admitted host machine identity SHA-256',
    )
    .action(
      action(async (options: ObserveDeploymentOptions, command: Command) => {
        assertManagedOptions(command, ['cliRef', 'deploymentRef']);
        requireJson();
        const selected = {
          ...options,
          cliRef: options.cliRef ?? command.parent?.getOptionValue('cliRef'),
          deploymentRef:
            options.deploymentRef ??
            command.parent?.getOptionValue('deploymentRef'),
        };
        if (!selected.cliRef || !selected.deploymentRef)
          throw usageError(
            'deploy observe requires --cli-ref and --deployment-ref.',
          );
        const report = await observationBoundary(async () =>
          observeDeployment(selected, await observationInput(process.stdin)),
        );
        writeObservationResult('deploy observe', report, report.complete);
      }),
    );
}

export function createNativeObserveCommand(): Command {
  return new Command('observe-native')
    .description('Observe retained native custody through the same pinned CLI')
    .action(
      action(async (_options, command: Command) => {
        assertManagedOptions(command, []);
        requireJson();
        const report = await observationBoundary(async () => {
          const input = nativeObservationInputSchema.parse(
            await observationInput(process.stdin),
          );
          const build = (
            await import('../../lib/deployment/build')
          ).deploymentBuild();
          if (
            build.revision !== input.cliRevision ||
            observationFile(build.binary, 256 * 1024 * 1024).sha256 !==
              input.cliSha256
          )
            throw preconditionError(
              'Native observation executable differs from its admitted source and bytes.',
            );
          return observeNativeDeployment(input);
        });
        const complete = report.status === 'observed';
        writeObservationResult('deploy observe-native', report, complete);
      }),
    );
}
