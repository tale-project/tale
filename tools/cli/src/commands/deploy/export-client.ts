import { Command } from 'commander';

import {
  exportManagedClient,
  type ExportClientOptions,
} from '../../lib/deployment/client-export';
import { clientExportTargetSchema } from '../../lib/deployment/client-export-model';
import { exportNativeClient } from '../../lib/deployment/client-export-native';
import { usageError } from '../../utils/fail';
import { action } from '../../utils/run-command';
import { managedResult } from './managed';
import { assertManagedOptions } from './options';

function bundleOptions(
  command: Command,
  options: { bundle?: string; cliRef?: string; deploymentRef?: string },
) {
  assertManagedOptions(command, ['bundle', 'cliRef', 'deploymentRef']);
  const bundle = options.bundle ?? command.parent?.getOptionValue('bundle');
  if (!bundle) throw usageError('--bundle is required.');
  return {
    bundle,
    cliRef: options.cliRef ?? command.parent?.getOptionValue('cliRef'),
    deploymentRef:
      options.deploymentRef ?? command.parent?.getOptionValue('deploymentRef'),
  };
}
export function createExportClientCommand(): Command {
  return new Command('export-client')
    .description(
      'Export one verified ready managed OIDC client to private consumer JSON files',
    )
    .option('--bundle <directory>', 'Exact completed deployment bundle')
    .option('--cli-ref <sha>', 'Expected Tale CLI source commit')
    .option('--deployment-ref <sha>', 'Expected orchestrator source commit')
    .requiredOption(
      '--client <key>',
      'Exact declared managed native client key',
    )
    .requiredOption(
      '--output <directory>',
      'New private output directory, or exact completed replay',
    )
    .option(
      '--env-prefix <name>',
      'Emit consumer-env.json using this uppercase variable prefix',
    )
    .action(
      action(async (options: ExportClientOptions, command: Command) => {
        const selected = bundleOptions(command, options);
        await managedResult('deploy export-client', () =>
          exportManagedClient({ ...options, ...selected }),
        );
      }),
    );
}
/** Internal transport endpoint: the same pinned CLI executes inside its backend.
 * Input is bounded, closed-schema selection metadata; no secret stdout path. */
export function createNativeExportClientCommand(): Command {
  return new Command('export-client-native')
    .description(
      'Verify and export a retained client inside its managed backend',
    )
    .option('--bundle <directory>', 'Exact prepared deployment bundle')
    .requiredOption('--output <directory>', 'Private native transfer directory')
    .action(
      action(
        async (
          options: { bundle?: string; output: string },
          command: Command,
        ) => {
          const selected = bundleOptions(command, options);
          await managedResult('deploy export-client-native', async () => {
            if (process.stdin.isTTY)
              throw usageError(
                'Provide the bounded credential-export selection on stdin.',
              );
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              for await (const value of process.stdin) {
                const chunk = Buffer.isBuffer(value)
                  ? value
                  : Buffer.from(value);
                size += chunk.length;
                if (size > 65536) throw Error('input bound');
                chunks.push(chunk);
              }
            } catch {
              throw usageError(
                'Credential export selection is unreadable or exceeds 64 KiB.',
              );
            }
            let input;
            try {
              input = clientExportTargetSchema.parse(
                JSON.parse(
                  new TextDecoder('utf-8', { fatal: true }).decode(
                    Buffer.concat(chunks),
                  ),
                ),
              );
            } catch {
              throw usageError('Invalid credential export selection.');
            }
            if (
              (selected.cliRef &&
                selected.cliRef !== input.deployment.cliRevision) ||
              (selected.deploymentRef &&
                selected.deploymentRef !== input.deployment.deploymentRef)
            )
              throw usageError(
                'Credential export selection differs from expected source pins.',
              );
            return exportNativeClient(selected.bundle, input, options.output);
          });
        },
      ),
    );
}
