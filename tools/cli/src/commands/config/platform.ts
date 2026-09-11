import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { Command } from 'commander';

import {
  applyPlatformConfiguration,
  planPlatformConfiguration,
  readPlatformConfiguration,
} from '../../lib/config/platform-apply';
import { connectPlatformConfiguration } from '../../lib/config/platform-client';
import {
  configurationPlanSchema,
  parsePlatformConfiguration,
  resourceId,
} from '../../lib/config/platform-model';
import { valueHash } from '../../lib/config/releases/identity';
import {
  NativeRequestError,
  ConfigError,
} from '../../lib/config/releases/model';
import { boundedJson, writePrivateJson } from '../../lib/state/private-files';
import { withLock } from '../../lib/state/with-lock';
import {
  CliError,
  externalDepError,
  preconditionError,
  usageError,
} from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode, resolveConsent } from '../../utils/output-mode';
import { confirm, NonInteractiveError } from '../../utils/prompt';
import { action } from '../../utils/run-command';

interface Flags {
  file: string;
  url?: string;
  origin?: string;
  org?: string;
  output?: string;
  plan?: string;
  receipt?: string;
}

/** Output publication must never replace its own declaration or reviewed plan,
 * including aliases through a symlinked parent directory. */
async function checkOutputPaths(flags: Flags) {
  const paths = [flags.file, flags.plan, flags.output, flags.receipt].filter(
    (path): path is string => path !== undefined,
  );
  const resolved = await Promise.all(
    paths.map(async (path) => {
      const absolute = resolve(path);
      try {
        return await realpath(absolute);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        )
          throw error;
        return resolve(await realpath(dirname(absolute)), basename(absolute));
      }
    }),
  );
  if (new Set(resolved).size !== resolved.length)
    throw usageError(
      'Configuration declaration, plan, output and receipt must use different files.',
    );
}

/** Native platform settings use the ordinary config command and the same JSON,
 * non-interactive consent, exit-code and environment-secret conventions. */
export function addPlatformCommands(parent: Command) {
  for (const verb of ['validate', 'read', 'plan', 'apply'] as const) {
    const command = parent
      .command(verb)
      .description(
        {
          validate: 'Validate a platform configuration against native schemas',
          read: 'Read the declared native platform settings',
          plan: 'Plan platform configuration changes without writing settings',
          apply:
            'Apply a reviewed configuration plan and verify native readback',
        }[verb],
      )
      .requiredOption(
        '--file <path>',
        'Platform configuration JSON declaration',
      );
    if (verb !== 'validate')
      command
        .requiredOption(
          '--url <origin>',
          'Tale HTTPS origin (HTTP allowed on loopback)',
        )
        .option(
          '--origin <origin>',
          'Public HTTPS origin when connecting over loopback',
        )
        .requiredOption('--org <id>', 'Native organization ID');
    if (verb === 'plan')
      command.option(
        '--output <path>',
        'Save the reviewed plan as private JSON',
      );
    if (verb === 'apply')
      command
        .requiredOption(
          '--plan <path>',
          'Saved plan for this exact declaration and target',
        )
        .requiredOption(
          '--receipt <path>',
          'Persistent private application journal',
        );
    command.action(
      action(async (flags: Flags) => {
        let result: unknown;
        try {
          await checkOutputPaths(flags);
          const declaration = parsePlatformConfiguration(
            await boundedJson(resolve(flags.file)),
          );
          if (verb === 'validate')
            result = {
              valid: true,
              configurationSha256: valueHash(declaration),
              resources: declaration.resources.map(resourceId),
            };
          else {
            if (!flags.url || !flags.org)
              throw usageError('--url and --org are required.');
            const client = await connectPlatformConfiguration({
              url: flags.url,
              origin: flags.origin,
              orgId: flags.org,
              cookie: process.env.TALE_CONFIG_COOKIE ?? '',
            });
            if (verb === 'read')
              result = await readPlatformConfiguration(declaration, client);
            if (verb === 'plan') {
              result = await planPlatformConfiguration(declaration, client);
              if (flags.output)
                await writePrivateJson(resolve(flags.output), result);
            }
            if (verb === 'apply') {
              if (!flags.plan || !flags.receipt)
                throw usageError('--plan and --receipt are required.');
              const plan = configurationPlanSchema.parse(
                await boundedJson(resolve(flags.plan)),
              );
              if (
                !resolveConsent(undefined) &&
                !(await confirm({
                  message: 'Apply this reviewed native configuration plan?',
                  default: false,
                }))
              )
                throw new NonInteractiveError(
                  'Platform configuration apply was not confirmed.',
                );
              const receipt = resolve(flags.receipt);
              result = await withLock(dirname(receipt), 'config apply', () =>
                applyPlatformConfiguration(declaration, plan, client, receipt),
              );
            }
          }
        } catch (error) {
          if (error instanceof CliError || error instanceof NonInteractiveError)
            throw error;
          if (error instanceof NativeRequestError)
            throw externalDepError(error.message);
          if (error instanceof ConfigError)
            throw preconditionError(error.message);
          throw preconditionError(
            'Platform configuration operation failed; check its declaration, native target and retained plan.',
          );
        }
        if (getOutputMode().json) emitJson(`config ${verb}`, result);
        else {
          logger.success(`Platform configuration ${verb} completed.`);
          logger.info(JSON.stringify(result, null, 2));
        }
      }),
    );
  }
}
