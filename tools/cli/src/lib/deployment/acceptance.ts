import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { sha256, stableJson } from '../config/releases/identity';
import { gitSha, sha, slug } from '../config/releases/model';
import { exec } from '../docker/exec';
import { validateLockPaths } from '../state/lock-guard';
import { withLock } from '../state/with-lock';
import {
  acceptanceHealth,
  localServingArgs,
  localServingIdentity,
  type ServingService,
} from './acceptance-health';
import {
  acceptedMigrations,
  acceptanceMigrationScript,
} from './acceptance-migrations';
import {
  acceptanceVersionSchema,
  deploymentAcceptanceSchema,
} from './acceptance-model';
import { withFrozenDeployment, type DeploymentBundle } from './bundle';
import { readProvisionStateProof } from './provision-state';
import { observeReadyState, startedAtSchema } from './runtime-apply';
import { runtimeProcessEnvironment } from './runtime-command';
import {
  readRuntimeBundle,
  requireRuntime,
  runtimeImageSchema,
  TALE_REGISTRY,
} from './runtime-model';
import { imageInspectSchema } from './runtime-prepare';

export interface AcceptDeploymentOptions {
  bundle: string;
  cliRef: string;
  deploymentRef: string;
  expectedVersion: string;
  originContainer?: string;
}
const readySchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal('ready'),
  name: slug,
  revision: gitSha,
  cliRevision: gitSha,
  deploymentRef: gitSha,
  bundleSha256: sha,
  images: z.array(runtimeImageSchema),
});
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const containerIdentitySchema = z.object({
  Id: sha,
  Image: digest,
  RestartCount: z.number().int().nonnegative(),
  State: z.object({ Running: z.literal(true), StartedAt: startedAtSchema }),
});
const originContainerSchema = containerIdentitySchema.extend({
  NetworkSettings: z.object({
    Networks: z.record(
      z.string().min(1),
      z.object({ NetworkID: sha, IPAddress: z.ipv4() }),
    ),
  }),
});
const imageIdentitySchema = z.object({
  Id: digest,
  Config: imageInspectSchema.shape.Config,
});
function ready(bundle: DeploymentBundle, directory: string) {
  try {
    lstatSync(
      join(bundle.spec.stateDirectory, '.tale', 'deployment-pending.json'),
    );
    throw preconditionError('An unfinished deployment prevents acceptance.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const proof = readProvisionStateProof(
    join(bundle.spec.stateDirectory, '.tale', 'deployment-ready.json'),
    readySchema,
    1_048_576,
  );
  const bundleSha256 = sha256(readFileSync(join(directory, 'deployment.json')));
  const runtime = readRuntimeBundle(join(directory, 'runtime')).bundle;
  requireRuntime(
    proof &&
      proof.value.name === bundle.spec.name &&
      proof.value.revision === bundle.spec.runtime.revision &&
      proof.value.cliRevision === bundle.cli.revision &&
      proof.value.deploymentRef === bundle.deploymentRef &&
      proof.value.bundleSha256 === bundleSha256 &&
      stableJson(proof.value.images) === stableJson(runtime.images),
    'Acceptance requires this exact completed deployment receipt.',
  );
  requireRuntime(
    runtime.migrations,
    'Acceptance requires a bundle with a source-derived migration inventory. Prepare a new bundle with a compatible CLI.',
  );
  return { proof, bundleSha256, runtime, migrations: runtime.migrations };
}

/** Observe only: no apply, environment resolution, credential export, migration
 * or application/configuration write. Uses the same deployment lock and an owned
 * bounded temporary bundle copy, removed by the existing custody helper. */
export async function acceptDeployment(
  options: AcceptDeploymentOptions,
  dependencies: {
    exec?: typeof exec;
    fetch?: typeof fetch;
    now?: () => number;
  } = {},
) {
  gitSha.parse(options.cliRef);
  gitSha.parse(options.deploymentRef);
  acceptanceVersionSchema.parse(options.expectedVersion);
  const originContainerId = sha.optional().parse(options.originContainer);
  const now = dependencies.now ?? performance.now.bind(performance);
  const deadline = now() + 120_000;
  let total = 0;
  const remaining = () => {
    const left = deadline - now();
    requireRuntime(
      left > 0,
      'Deployment acceptance exceeded its observation deadline.',
    );
    return left;
  };
  const run: typeof exec = async (command, args, execution = {}) => {
    const left = remaining();
    let result;
    try {
      result = await (dependencies.exec ?? exec)(command, args, {
        ...execution,
        silent: true,
        timeout: Math.min(15, left / 1000),
        maxOutputBytes: 1_048_576,
        env: runtimeProcessEnvironment(),
      });
    } catch {
      throw externalDepError(
        'The bounded deployment acceptance observation failed.',
      );
    }
    total +=
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
    requireRuntime(
      total <= 16_777_216,
      'Deployment acceptance exceeded its aggregate byte limit.',
    );
    remaining();
    return result;
  };
  const query = async (args: string[], stdin?: string) => {
    const result = await run('docker', args, { stdin });
    requireRuntime(
      result.success,
      'Docker refused the deployment acceptance observation.',
    );
    return result.stdout;
  };
  return withFrozenDeployment(
    options.bundle,
    options,
    async (directory, bundle) => {
      requireRuntime(
        await validateLockPaths(bundle.spec.stateDirectory),
        'Acceptance requires an existing deployment state directory.',
      );
      ready(bundle, directory);
      return withLock(bundle.spec.stateDirectory, 'deploy accept', async () => {
        const initial = ready(bundle, directory);
        const runtimeOptions = {
          bundleDirectory: join(directory, 'runtime'),
          stateDirectory: bundle.spec.stateDirectory,
          composeProject: bundle.spec.composeProject,
          name: bundle.spec.name,
          origin: bundle.spec.origin,
          additionalOrigins: bundle.spec.additionalOrigins,
          tlsMode: bundle.spec.tlsMode,
          tlsEmail: bundle.spec.tlsEmail,
        };
        const before = await observeReadyState(runtimeOptions, { exec: run });
        const ids = before.containers.map((c) => c.Id).sort();
        const identities = async () => {
          const values = z
            .array(containerIdentitySchema)
            .min(1)
            .max(64)
            .parse(JSON.parse(await query(['container', 'inspect', ...ids])))
            .sort((a, b) => a.Id.localeCompare(b.Id));
          requireRuntime(
            stableJson(values.map((c) => c.Id)) === stableJson(ids),
            'Acceptance container identities differ.',
          );
          return values;
        };
        const started = await identities();
        const observedImages = new Map<string, string>();
        for (const image of initial.runtime.images) {
          const values = z
            .array(imageIdentitySchema)
            .length(1)
            .parse(
              JSON.parse(await query(['image', 'inspect', image.reference])),
            );
          const actual = values[0];
          if (image.repository.startsWith(`${TALE_REGISTRY}/`)) {
            // A sha-<source> reference is legitimate metadata, never served version.
            requireRuntime(
              actual.Config.Labels?.['org.opencontainers.image.version'] ===
                options.expectedVersion &&
                actual.Config.Labels?.['org.opencontainers.image.revision'] ===
                  initial.runtime.revision,
              'A Tale runtime image does not prove the expected release version and source.',
            );
          }
          observedImages.set(image.reference, actual.Id);
        }
        for (const container of before.containers)
          requireRuntime(
            started.find((c) => c.Id === container.Id)?.Image ===
              observedImages.get(container.Config.Image),
            'A running container differs from its pinned image identity.',
          );
        const ledger = async (service: 'db' | 'knowledge-db') => {
          const matches = before.containers.filter(
            (c) => c.Config.Labels?.['com.docker.compose.service'] === service,
          );
          requireRuntime(
            matches.length === 1,
            'Acceptance requires one captured database container per service.',
          );
          return query(
            ['exec', '-i', matches[0].Id, 'sh', '-s'],
            acceptanceMigrationScript(service),
          );
        };
        const app = await ledger('db');
        const knowledge = await ledger('knowledge-db');
        const migrations = acceptedMigrations(
          initial.migrations,
          app,
          knowledge,
        );
        const localServing = async (service: ServingService) => {
          const matches = before.containers.filter(
            (c) => c.Config.Labels?.['com.docker.compose.service'] === service,
          );
          requireRuntime(
            matches.length === 1,
            'Acceptance requires one captured container per serving process.',
          );
          return localServingIdentity(
            await query(localServingArgs(matches[0].Id, service)),
            service,
          );
        };
        const captureOrigin = async () => {
          if (!originContainerId) return undefined;
          const values = z
            .array(originContainerSchema)
            .length(1)
            .parse(
              JSON.parse(
                await query(['container', 'inspect', originContainerId]),
              ),
            );
          const captured = values[0];
          const networks = Object.values(captured.NetworkSettings.Networks);
          requireRuntime(
            captured.Id === originContainerId && networks.length === 1,
            'The private origin requires one captured running container and network address.',
          );
          return {
            captured,
            address: networks[0].IPAddress,
            networkId: networks[0].NetworkID,
          };
        };
        const origin = await captureOrigin();
        const verifyOrigin = async () => {
          if (!origin) return;
          requireRuntime(
            stableJson(await captureOrigin()) === stableJson(origin),
            'The private origin container or network changed during acceptance.',
          );
        };
        const frontend = await localServing('platform');
        const backend = await localServing('backend-api');
        const canonicalServing = async () => {
          await verifyOrigin();
          for (const process of [frontend, backend])
            await acceptanceHealth(
              bundle.spec.origin,
              options.expectedVersion,
              process,
              remaining(),
              dependencies.fetch,
              origin?.address,
            );
          await verifyOrigin();
        };
        await canonicalServing();
        const serving = {
          status: 'ok',
          version: options.expectedVersion,
          origin: bundle.spec.origin,
          ...(origin
            ? {
                originRoute: {
                  kind: 'container' as const,
                  containerId: origin.captured.Id,
                  networkId: origin.networkId,
                  address: origin.address,
                },
              }
            : {}),
          frontend,
          backend,
        };
        // Recheck the whole runtime custody, every container identity, current
        // migration ledgers and Ready bytes before returning the compact receipt.
        const after = await observeReadyState(runtimeOptions, { exec: run });
        requireRuntime(
          stableJson(after.containers.map((c) => c.Id).sort()) ===
            stableJson(ids) &&
            stableJson(await identities()) === stableJson(started),
          'Runtime identity changed during deployment acceptance.',
        );
        requireRuntime(
          app === (await ledger('db')) &&
            knowledge === (await ledger('knowledge-db')),
          'Migration ledgers changed during deployment acceptance.',
        );
        requireRuntime(
          stableJson(await identities()) === stableJson(started),
          'Runtime identity changed during final ledger observation.',
        );
        // The origin may change while local custody/ledger reads settle. Bind
        // both routes again, then verify the captured processes still match.
        await canonicalServing();
        requireRuntime(
          stableJson(await localServing('platform')) === stableJson(frontend) &&
            stableJson(await localServing('backend-api')) ===
              stableJson(backend),
          'Serving process changed during deployment acceptance.',
        );
        await verifyOrigin();
        const final = ready(bundle, directory);
        requireRuntime(
          final.proof.sha256 === initial.proof.sha256,
          'Ready deployment changed during acceptance.',
        );
        remaining();
        return deploymentAcceptanceSchema.parse({
          schemaVersion: 1,
          kind: 'tale-deployment-acceptance',
          name: bundle.spec.name,
          revision: initial.runtime.revision,
          cliRevision: bundle.cli.revision,
          deploymentRef: bundle.deploymentRef,
          bundleSha256: initial.bundleSha256,
          readyReceiptSha256: initial.proof.sha256,
          observedAt: new Date().toISOString(),
          version: options.expectedVersion,
          images: initial.runtime.images,
          serving,
          migrations,
        });
      });
    },
  );
}
