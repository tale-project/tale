import { resolve } from 'node:path';

import { Command } from 'commander';

import {
  withFrozenDeployment,
  type DeploymentBundle,
} from '../../lib/deployment/bundle';
import { provisionDeploymentConfigs } from '../../lib/deployment/configs';
import { createBackendEmailAttestation } from '../../lib/deployment/email-attestation';
import {
  configureInstance,
  parsePrivateInstanceJson,
  PRIVATE_INPUT_LIMIT,
  type InstanceInput,
  type InstanceOptions,
} from '../../lib/deployment/identity';
import { provisionDeploymentInference } from '../../lib/deployment/inference-native';
import {
  createBackendNativeClients,
  createBackendNativeUpdate,
} from '../../lib/deployment/native-client';
import { nativeDeploymentStateDirectory } from '../../lib/deployment/provision-state';
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
import { assertManagedOptions } from './options';

/** Stream private input with a byte cap, before decoding or parsing secrets. */
export async function readPrivateProvisionInput(
  source: AsyncIterable<unknown> = process.stdin,
): Promise<InstanceInput> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const value of source) {
      if (typeof value !== 'string' && !Buffer.isBuffer(value))
        throw usageError('Invalid native instance provisioning input stream.');
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      size += chunk.byteLength;
      if (size > PRIVATE_INPUT_LIMIT)
        throw usageError('Native instance provisioning input exceeds 64 KiB.');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw usageError(
      'Unable to read private native instance provisioning input.',
    );
  }
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw usageError('Native instance provisioning input is not valid UTF-8.');
  }
  return parsePrivateInstanceJson(raw);
}

/** Credential references are resolved by the destination before private stdin.
 * Public declared fields must still match the reviewed bundle before login. */
export function verifyProvisionIdentity(
  bundle: DeploymentBundle,
  input: InstanceInput,
): void {
  const identity = bundle.spec.identity;
  if (
    !identity ||
    bundle.spec.origin !== input.origin ||
    identity.slug !== input.slug ||
    identity.name !== input.name ||
    identity.ssoEnabled !== input.ssoEnabled ||
    identity.bootstrap !== input.bootstrap ||
    identity.emailVerification !== input.emailVerification ||
    (typeof identity.email === 'string' &&
      identity.email.toLowerCase() !== input.email.toLowerCase()) ||
    identity.nativeClients.length !== input.nativeClients.length
  )
    throw preconditionError(
      'Private provisioning identity differs from the deployment bundle.',
    );
  for (const desired of identity.nativeClients) {
    const supplied = input.nativeClients.find(
      (client) => client.key === desired.key,
    );
    if (
      !supplied ||
      supplied.name !== desired.name ||
      supplied.managed !== desired.managed ||
      (typeof desired.clientId === 'string' &&
        supplied.clientId !== desired.clientId) ||
      JSON.stringify(supplied.redirectUris) !==
        JSON.stringify(desired.redirectUris)
    )
      throw preconditionError(
        'Private native client identity differs from the deployment bundle.',
      );
  }
}

export interface ManagedProvisionDependencies {
  dataDirectory?: string;
  configure?: typeof configureInstance;
  configs?: typeof provisionDeploymentConfigs;
  inference?: typeof provisionDeploymentInference;
  nativeUpdate?: InstanceOptions['nativeUpdate'];
  managedClients?: InstanceOptions['managedClients'];
  emailAttestation?: InstanceOptions['emailAttestation'];
}

/** One private native lock spans identity, credentials, inference and configs.
 * The verified source is copied before use; only safe metadata leaves the call. */
export async function provisionManagedBundle(
  directory: string,
  input: InstanceInput,
  pins: { cliRef?: string; deploymentRef?: string } = {},
  dependencies: ManagedProvisionDependencies = {},
) {
  return withFrozenDeployment(directory, pins, async (frozen, bundle) => {
    verifyProvisionIdentity(bundle, input);
    const stateDirectory = nativeDeploymentStateDirectory(
      dependencies.dataDirectory ?? '/app/data',
      bundle.spec.name,
    );
    return withLock(stateDirectory, 'deploy provision', async () => {
      let configs: unknown[] = [];
      let inference: Awaited<ReturnType<typeof provisionDeploymentInference>>;
      const identity = await (dependencies.configure ?? configureInstance)(
        input,
        {
          stateDirectory,
          emailAttestation:
            dependencies.emailAttestation ??
            createBackendEmailAttestation({ origin: input.origin }),
          nativeUpdate:
            dependencies.nativeUpdate ??
            createBackendNativeUpdate({ origin: input.origin }),
          managedClients:
            dependencies.managedClients ??
            createBackendNativeClients({ origin: input.origin }),
          provision: async (context) => {
            inference = await (
              dependencies.inference ?? provisionDeploymentInference
            )(frozen, context);
            configs = await (
              dependencies.configs ?? provisionDeploymentConfigs
            )(frozen, context);
          },
        },
      );
      return { ...identity, configs, ...(inference ? { inference } : {}) };
    });
  });
}

export function createProvisionCommand(): Command {
  return new Command('provision')
    .description(
      'Provision one native instance from private JSON stdin inside its backend',
    )
    .option(
      '--bundle <directory>',
      'Verify and provision this prepared deployment bundle',
    )
    .action(
      action(async (flags: { bundle?: string }, command: Command) => {
        let result;
        try {
          assertManagedOptions(command, ['bundle', 'cliRef', 'deploymentRef']);
          if (process.stdin.isTTY)
            throw usageError('Provide private native instance JSON on stdin.');
          const input = await readPrivateProvisionInput();
          // Commander may consume these shared flags on the parent deploy
          // command even when they follow this subcommand. Do not let a root
          // default from optsWithGlobals overwrite the explicit parent value.
          const inherited = command.parent?.opts<{
            bundle?: string;
            yes?: boolean;
            cliRef?: string;
            deploymentRef?: string;
          }>();
          const selectedBundle = flags.bundle ?? inherited?.bundle;
          if (selectedBundle === '')
            throw usageError('--bundle must name a deployment directory.');
          if (
            selectedBundle === undefined &&
            (inherited?.cliRef !== undefined ||
              inherited?.deploymentRef !== undefined)
          )
            throw usageError('Expected deployment pins require --bundle.');
          const directory = selectedBundle
            ? resolve(selectedBundle)
            : undefined;
          if (
            !directory &&
            (input.bootstrap ||
              input.nativeClients.some((client) => client.managed))
          )
            throw preconditionError(
              'Fresh native provisioning requires a verified deployment bundle.',
            );
          if (
            !resolveConsent(inherited?.yes) &&
            !(await confirm({
              message: 'Provision the selected native instance?',
              default: false,
            }))
          )
            throw new NonInteractiveError(
              'Native instance provisioning was not confirmed.',
            );
          result = directory
            ? await provisionManagedBundle(directory, input, {
                cliRef: inherited?.cliRef,
                deploymentRef: inherited?.deploymentRef,
              })
            : {
                ...(await configureInstance(input, {
                  nativeUpdate: createBackendNativeUpdate({
                    origin: input.origin,
                  }),
                })),
                configs: [],
              };
        } catch (error) {
          if (error instanceof CliError || error instanceof NonInteractiveError)
            throw error;
          throw externalDepError('Native instance provisioning failed.');
        }
        if (getOutputMode().json) emitJson('deploy provision', result);
        else {
          logger.success('Native instance provisioning completed.');
          logger.info(JSON.stringify(result, null, 2));
        }
      }),
    );
}
