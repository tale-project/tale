import { Command } from 'commander';
import { z } from 'zod';

import {
  prepareInference,
  prepareInferenceFromSource,
  verifyInferenceBundle,
} from '../../lib/inference/bundle';
import { boundedJson } from '../../lib/inference/files';
import {
  applyInference,
  benchmarkInference,
  rollbackInference,
  statusInference,
} from '../../lib/inference/lifecycle';
import { observeMacHardware } from '../../lib/inference/macos';
import { hardwareSchema, planInference } from '../../lib/inference/plan';
import { writeInferenceRouter } from '../../lib/inference/router';
import { CliError, preconditionError, usageError } from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode, resolveConsent } from '../../utils/output-mode';
import { confirm, NonInteractiveError } from '../../utils/prompt';
import { action } from '../../utils/run-command';

interface Selection {
  bundle: string;
  bundleSha: string;
  node: string;
  yes?: boolean;
}
const selection = (options: Selection) => ({
  bundle: options.bundle,
  bundleSha256: options.bundleSha,
  node: options.node,
});
async function result(command: string, work: () => Promise<unknown>) {
  let output;
  try {
    output = await work();
  } catch (error) {
    if (error instanceof CliError || error instanceof NonInteractiveError)
      throw error;
    if (error instanceof z.ZodError)
      throw preconditionError(
        'Inference input does not match its declared schema.',
      );
    throw preconditionError(
      'Inference operation failed. Check the selected files, destination admission and retained private recovery receipts.',
    );
  }
  if (getOutputMode().json) emitJson(command, output);
  else {
    logger.success(`${command} completed.`);
    logger.info(JSON.stringify(output, null, 2));
  }
}
const selected = (name: string, description: string) =>
  new Command(name)
    .description(description)
    .requiredOption(
      '--bundle <directory>',
      'Prepared immutable inference bundle',
    )
    .requiredOption(
      '--bundle-sha <sha256>',
      'Expected inference bundle SHA-256',
    );
async function consent(options: { yes?: boolean }, text: string) {
  if (
    !resolveConsent(options.yes) &&
    !(await confirm({ message: text, default: false }))
  )
    throw new NonInteractiveError('Inference operation was not confirmed.');
}

export function createInferenceCommand(): Command {
  const command = new Command('inference').description(
    'Prepare and operate pinned private inference nodes and model routes',
  );
  command.addCommand(
    new Command('prepare')
      .description(
        'Prepare exact runtime/model metadata without downloading weights',
      )
      .requiredOption('--spec <file>', 'Inference specification JSON')
      .requiredOption('--output <directory>', 'New immutable bundle directory')
      .option(
        '--repository <url>',
        'Canonical GitHub client repository; reads only the pinned committed spec',
      )
      .option(
        '--source-ref <sha>',
        'Full client source commit, required with --repository',
      )
      .option(
        '--sources <file>',
        'Optional offline repository@SHA checkout map',
      )
      .action(
        action(
          async (options: {
            spec: string;
            output: string;
            repository?: string;
            sourceRef?: string;
            sources?: string;
          }) =>
            result('inference prepare', async () => {
              if (
                (options.repository === undefined) !==
                  (options.sourceRef === undefined) ||
                (options.sources !== undefined &&
                  options.repository === undefined)
              )
                throw usageError(
                  'Committed inference preparation requires --repository and --source-ref together.',
                );
              const bundle =
                options.repository !== undefined &&
                options.sourceRef !== undefined
                  ? await prepareInferenceFromSource({
                      ...options,
                      repository: options.repository,
                      sourceRef: options.sourceRef,
                    })
                  : await prepareInference(options.spec, options.output);
              return {
                bundleSha256: bundle.bundleSha256,
                output: options.output,
                modelCount: bundle.spec.models.length,
                nodeCount: bundle.spec.nodes.length,
                modelWeightsDownloaded: false,
                source: bundle.source
                  ? {
                      repository: bundle.source.repository,
                      revision: bundle.source.revision,
                      specPath: bundle.source.specPath,
                      sha256: bundle.source.sha256,
                    }
                  : null,
              };
            }),
        ),
      ),
  );
  command.addCommand(
    selected('validate', 'Verify offline inference bundle identity').action(
      action(async (options: Selection) =>
        result('inference validate', async () => {
          const bundle = await verifyInferenceBundle(
            options.bundle,
            options.bundleSha,
          );
          return { verified: true, bundleSha256: bundle.bundleSha256 };
        }),
      ),
    ),
  );
  command.addCommand(
    selected(
      'plan',
      'Compare immutable model requirements with optional observed target hardware',
    )
      .option('--hardware <file>', 'Previously observed hardware JSON')
      .option(
        '--observe',
        'Observe this Mac without installing or loading a model',
      )
      .action(
        action(
          async (
            options: Selection & { hardware?: string; observe?: boolean },
          ) =>
            result('inference plan', async () => {
              if (options.hardware && options.observe)
                throw usageError('Choose --hardware or --observe, not both.');
              const bundle = await verifyInferenceBundle(
                options.bundle,
                options.bundleSha,
              );
              const hardware = options.hardware
                ? hardwareSchema.parse(await boundedJson(options.hardware))
                : options.observe
                  ? await observeMacHardware()
                  : undefined;
              return {
                bundleSha256: bundle.bundleSha256,
                ...(hardware ? { hardware } : {}),
                nodes: planInference(bundle.spec, hardware),
              };
            }),
        ),
      ),
  );
  command.addCommand(
    selected(
      'apply',
      'Verify, stage and activate this declared macOS inference node',
    )
      .requiredOption('--node <key>', 'Declared target node key')
      .option('-y, --yes', 'Confirm activation without an interactive prompt')
      .action(
        action(async (options: Selection) =>
          result('inference apply', async () => {
            await consent(
              options,
              'Apply the pinned inference release on this declared Mac?',
            );
            return applyInference(selection(options));
          }),
        ),
      ),
  );
  command.addCommand(
    selected(
      'status',
      'Verify this Mac’s current release, model bytes, kernels and private API',
    )
      .requiredOption('--node <key>', 'Declared target node key')
      .action(
        action(async (options: Selection) =>
          result('inference status', () => statusInference(selection(options))),
        ),
      ),
  );
  command.addCommand(
    selected(
      'benchmark',
      'Measure bounded synthetic baseline and mixed capability requests on this ready Mac',
    )
      .requiredOption('--node <key>', 'Declared target node key')
      .option('-y, --yes', 'Confirm bounded synthetic model execution')
      .action(
        action(async (options: Selection) =>
          result('inference benchmark', async () => {
            await consent(
              options,
              'Run bounded synthetic model requests on this declared Mac?',
            );
            return benchmarkInference(selection(options));
          }),
        ),
      ),
  );
  command.addCommand(
    selected(
      'rollback',
      'Activate the retained previous release after full verification',
    )
      .requiredOption('--node <key>', 'Declared target node key')
      .requiredOption('--release <sha256>', 'Retained release identity')
      .option('-y, --yes', 'Confirm rollback without an interactive prompt')
      .action(
        action(async (options: Selection & { release: string }) =>
          result('inference rollback', async () => {
            await consent(
              options,
              'Restore the retained inference release on this declared Mac?',
            );
            return rollbackInference({
              ...selection(options),
              release: options.release,
            });
          }),
        ),
      ),
  );
  command.addCommand(
    selected(
      'router',
      'Prepare private Caddy routes from exact fresh node status proofs',
    )
      .requiredOption(
        '--topology <file>',
        'Reviewed private network topology JSON',
      )
      .requiredOption('--output <directory>', 'New router artifact directory')
      .option(
        '--proof <files...>',
        'Safe data objects from exact inference status responses',
      )
      .action(
        action(
          async (
            options: Selection & {
              topology: string;
              output: string;
              proof?: string[];
            },
          ) =>
            result('inference router', async () => {
              const bundle = await verifyInferenceBundle(
                options.bundle,
                options.bundleSha,
              );
              return writeInferenceRouter(
                options.output,
                bundle,
                await boundedJson(options.topology),
                await Promise.all((options.proof ?? []).map(boundedJson)),
              );
            }),
        ),
      ),
  );
  return command;
}
