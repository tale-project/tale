import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { isValidSnapshotId, RESTORABLE_ARCHIVES } from '../backup/constants';
import { createSnapshot } from '../backup/create-snapshot';
import { verifySnapshot } from '../backup/verify-snapshot';
import { verifyArtifactBytes } from '../config/releases/artifacts';
import { sha256 } from '../config/releases/identity';
import { loadClient } from '../config/releases/identity';
import { loadRelease } from '../config/releases/manifest';
import { sha, slug } from '../config/releases/model';
import { validateNativeRelease } from '../config/releases/native';
import { exec } from '../docker/exec';
import { setProjectId } from '../project/project-context';
import { withLock } from '../state/with-lock';
import { withFrozenDeployment, type DeploymentBundle } from './bundle';
import {
  buildCapsuleStage,
  verifyPreparedDeploymentConfig,
} from './config-source';
import { parseInstanceInput, type InstanceInput } from './identity';
import { resolveValue } from './model';
import { verifyNativeModelSettingsProof } from './model-settings-proof';
import { nativeProvisionProofSchema } from './native-proof';
import {
  applyRuntime,
  readBootstrapPassword,
  type RuntimeResult,
} from './runtime';
import { runtimeProcessEnvironment } from './runtime-command';
import {
  atomicRuntimeFile,
  readRegular,
  readRuntimeBundle,
} from './runtime-model';

export interface ApplyDeploymentOptions {
  bundle: string;
  cliRef?: string;
  deploymentRef?: string;
  dryRun?: boolean;
}

type Dependencies = {
  runtime?: typeof applyRuntime;
  snapshot?: typeof createSnapshot;
  verifySnapshot?: typeof verifySnapshot;
  exec?: typeof exec;
  bootstrapPassword?: typeof readBootstrapPassword;
};

const recoverySnapshotSchema = z.object({
  id: z.string().refine(isValidSnapshotId),
  volumes: z
    .record(
      z
        .string()
        .refine((name) =>
          RESTORABLE_ARCHIVES.some((archive) => archive === name),
        ),
      z.strictObject({
        sha256: sha,
        sizeBytes: z.number().int().nonnegative(),
      }),
    )
    .refine((volumes) => Object.keys(volumes).length > 0),
});
const deploymentIntentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.literal('pending'),
  name: slug,
  bundleSha256: sha,
  snapshot: recoverySnapshotSchema.optional(),
});

function nativeInput(
  bundle: DeploymentBundle,
  password: string,
): InstanceInput | undefined {
  const identity = bundle.spec.identity;
  if (!identity) return undefined;
  return parseInstanceInput({
    origin: bundle.spec.origin,
    email: resolveValue(identity.email),
    password: identity.password ? resolveValue(identity.password) : password,
    slug: identity.slug,
    name: identity.name,
    ssoEnabled: identity.ssoEnabled,
    ...(identity.bootstrap ? { bootstrap: identity.bootstrap } : {}),
    ...(identity.emailVerification
      ? { emailVerification: identity.emailVerification }
      : {}),
    ...(identity.ssoEnabled
      ? {
          tenantId: identity.tenantId && resolveValue(identity.tenantId),
          clientId: identity.clientId && resolveValue(identity.clientId),
          clientSecret:
            identity.clientSecret && resolveValue(identity.clientSecret),
        }
      : {}),
    nativeClients: identity.nativeClients.map((client) => {
      const selected = {
        key: client.key,
        name: client.name,
        redirectUris: client.redirectUris,
      };
      if (client.managed) return Object.assign(selected, { managed: true });
      if (!client.clientId)
        throw preconditionError('Native client identity is missing.');
      return Object.assign(selected, {
        clientId: resolveValue(client.clientId),
      });
    }),
  });
}

interface ConfigProof {
  client: string;
  automation: string;
  revision: string;
  artifactSha256?: string;
  sourceCapsuleSha256?: string;
}
async function capsuleArtifact(
  directory: string,
  owner: string,
): Promise<string> {
  const temporary = mkdtempSync(join(tmpdir(), 'tale-owner-proof-'));
  try {
    const stage = await buildCapsuleStage(directory, temporary, owner);
    if (!stage.artifactSha256)
      throw preconditionError('Compiled source artifact proof is missing.');
    return stage.artifactSha256;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
async function configProofs(bundle: DeploymentBundle, directory: string) {
  const proofs: ConfigProof[] = [];
  for (const config of bundle.spec.configs) {
    const prepared = await verifyPreparedDeploymentConfig(
      join(directory, 'configs', config.client, config.automation),
      {
        clientId: config.client,
        automationName: config.automation,
        releaseRef: resolveValue(config.revision),
        sourceRepository: config.repository,
        deploymentRef: bundle.deploymentRef,
      },
    );
    if ((prepared.kind === 'source') !== (config.skillOwner === 'operator'))
      throw preconditionError(
        'Prepared configuration owner mode differs from the deployment.',
      );
    if (prepared.kind === 'source') {
      await capsuleArtifact(
        join(directory, 'configs', config.client, config.automation),
        'source-validation-only',
      );
      proofs.push({
        client: config.client,
        automation: config.automation,
        revision: resolveValue(config.revision),
        sourceCapsuleSha256: prepared.capsuleSha256,
      });
      continue;
    }
    const stage = prepared.stage;
    const context = loadClient(stage.descriptorPath, config.automation);
    const release = loadRelease(stage.manifestPath, context);
    await verifyArtifactBytes(release);
    await validateNativeRelease(release);
    proofs.push({
      client: config.client,
      automation: config.automation,
      revision: resolveValue(config.revision),
      artifactSha256: release.manifest.artifact.sha256,
    });
  }
  return proofs;
}

/** Provision through the same compiled CLI in the running backend. Credentials
 * travel on private stdin; the host never receives an authenticated cookie. */
async function provisionBackend(
  bundle: DeploymentBundle,
  directory: string,
  runtime: RuntimeResult,
  configs: Awaited<ReturnType<typeof configProofs>>,
  dependencies: Dependencies,
): Promise<unknown> {
  if (!bundle.spec.identity) return undefined;
  if (!runtime.backendContainer)
    throw preconditionError('The healthy native backend was not identified.');
  const password = bundle.spec.identity.password
    ? resolveValue(bundle.spec.identity.password)
    : (dependencies.bootstrapPassword ?? readBootstrapPassword)(
        bundle.spec.stateDirectory,
      );
  const input = nativeInput(bundle, password);
  if (!input) throw preconditionError('Native deployment identity is missing.');
  const temporary = `/tmp/tale-deploy-${randomUUID()}`;
  const run = async (args: string[], stdin?: string, allowFailure = false) => {
    let result;
    try {
      result = await (dependencies.exec ?? exec)('docker', args, {
        env: runtimeProcessEnvironment(),
        silent: true,
        timeout: 600,
        stdin,
      });
    } catch {
      throw externalDepError('The backend-local Tale CLI could not run.');
    }
    if (!result.success && !allowFailure)
      throw externalDepError(
        'The backend-local Tale CLI did not complete provisioning. Its previous receipts are retained for recovery.',
      );
    return result;
  };
  await run([
    'exec',
    runtime.backendContainer,
    'mkdir',
    '-m',
    '700',
    temporary,
  ]);
  try {
    await run([
      'cp',
      `${directory}/.`,
      `${runtime.backendContainer}:${temporary}/`,
    ]);
    const result = await run(
      [
        'exec',
        '-i',
        '-w',
        '/',
        runtime.backendContainer,
        `${temporary}/cli/tale`,
        'deploy',
        'provision',
        '--bundle',
        temporary,
        '--json',
        '--yes',
      ],
      JSON.stringify(input),
    );
    if (Buffer.byteLength(result.stdout, 'utf8') > 1_048_576)
      throw externalDepError(
        'Native provisioning returned an oversized receipt.',
      );
    let output: unknown;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      throw externalDepError(
        'Native provisioning did not return one JSON receipt.',
      );
    }
    const parsed = z
      .object({
        ok: z.literal(true),
        command: z.literal('deploy provision'),
        data: nativeProvisionProofSchema,
      })
      .safeParse(output);
    if (
      !parsed.success ||
      parsed.data.data.organizationSlug !== bundle.spec.identity.slug ||
      parsed.data.data.ssoEnabled !== bundle.spec.identity.ssoEnabled ||
      (input.emailVerification
        ? !parsed.data.data.emailVerification ||
          parsed.data.data.emailVerification.userId !==
            parsed.data.data.userId ||
          parsed.data.data.emailVerification.email !==
            input.email.toLowerCase() ||
          parsed.data.data.emailVerification.receipt.path !==
            `/app/data/ops/tale-deployments/${bundle.spec.name}/private/email-attestation.json`
        : parsed.data.data.emailVerification !== undefined) ||
      parsed.data.data.configs.length !== bundle.spec.configs.length ||
      parsed.data.data.nativeClients.length !== input.nativeClients.length ||
      parsed.data.data.nativeClients.some((client, index) => {
        const expected = input.nativeClients[index];
        return (
          client.key !== expected?.key ||
          (expected.managed
            ? client.credentials?.path !==
              `/app/data/ops/tale-deployments/${bundle.spec.name}/private/client-${expected.key}.json`
            : client.clientId !== expected.clientId ||
              client.credentials !== undefined)
        );
      }) ||
      parsed.data.data.configs.some((config, index) => {
        const expected = bundle.spec.configs[index];
        const proof = configs[index];
        return (
          !expected ||
          !proof ||
          config.clientId !== expected.client ||
          config.automationName !== expected.automation ||
          config.releaseRef !== expected.revision ||
          config.sourceCommit !== expected.revision ||
          config.sourceRepository !== expected.repository ||
          (expected.projectId !== undefined &&
            config.projectId !== expected.projectId) ||
          (proof.artifactSha256 !== undefined &&
            config.artifactSha256 !== proof.artifactSha256) ||
          config.sourceCapsuleSha256 !== proof.sourceCapsuleSha256 ||
          (expected.skillOwner === 'operator' &&
            config.skillOwnerUserId !== parsed.data.data.userId)
        );
      })
    )
      throw externalDepError(
        'Native provisioning receipt differs from the reviewed deployment.',
      );
    let modelSettings;
    if (bundle.spec.modelSettings) {
      modelSettings = verifyNativeModelSettingsProof(
        parsed.data.data.modelSettings,
        bundle.spec.modelSettings,
        sha256(await readFile(join(directory, 'deployment.json'))),
        parsed.data.data.organizationId,
        input.slug,
      );
    } else if (parsed.data.data.modelSettings !== undefined) {
      throw externalDepError(
        'Native model settings receipt has no declared settings.',
      );
    }
    for (const [index, config] of parsed.data.data.configs.entries()) {
      const proof = configs[index];
      if (!proof.sourceCapsuleSha256) continue;
      const artifact = await capsuleArtifact(
        join(directory, 'configs', proof.client, proof.automation),
        parsed.data.data.userId,
      );
      if (artifact !== config.artifactSha256)
        throw externalDepError(
          'Native late-owner artifact differs from independent source compilation.',
        );
      proof.artifactSha256 = artifact;
    }
    return { ...parsed.data.data, modelSettings };
  } finally {
    let cleaned = false;
    try {
      const result = await run(
        ['exec', runtime.backendContainer, 'rm', '-rf', temporary],
        undefined,
        true,
      );
      cleaned = result.success;
    } catch {
      // Cleanup failure must not replace the original provisioning error.
    }
    if (!cleaned)
      logger.warn(
        'The backend deployment temporary directory could not be removed.',
      );
  }
}

/** One lock covers state adoption, snapshot, stack rollout and native setup.
 * A ready receipt is written only after every native readback and sign-out. */
export async function applyDeployment(
  options: ApplyDeploymentOptions,
  dependencies: Dependencies = {},
) {
  return withFrozenDeployment(options.bundle, options, (directory, bundle) =>
    applyVerifiedDeployment(options, dependencies, directory, bundle),
  );
}

async function applyVerifiedDeployment(
  options: ApplyDeploymentOptions,
  dependencies: Dependencies,
  directory: string,
  bundle: DeploymentBundle,
) {
  const runtimeBundle = readRuntimeBundle(join(directory, 'runtime')).bundle;
  if (
    runtimeBundle.revision !== bundle.spec.runtime.revision ||
    runtimeBundle.platform !== bundle.spec.runtime.platform
  )
    throw preconditionError(
      'Runtime bundle differs from the selected source revision or platform.',
    );
  const configs = await configProofs(bundle, directory);
  const bundleSha256 = sha256(
    await readFile(join(directory, 'deployment.json')),
  );
  // Validate every environment reference before Docker can change the stack.
  nativeInput(bundle, 'validated-after-runtime-preflight');
  const environment = Object.fromEntries(
    Object.entries(bundle.spec.environment).map(([name, reference]) => [
      name,
      resolveValue(reference),
    ]),
  );
  const runtimeOptions = {
    bundleDirectory: join(directory, 'runtime'),
    stateDirectory: bundle.spec.stateDirectory,
    composeProject: bundle.spec.composeProject,
    name: bundle.spec.name,
    origin: bundle.spec.origin,
    tlsMode: bundle.spec.tlsMode,
    tlsEmail: bundle.spec.tlsEmail,
    environment,
  };
  const runtime = dependencies.runtime ?? applyRuntime;
  if (options.dryRun) {
    return {
      dryRun: true,
      runtime: await runtime({ ...runtimeOptions, dryRun: true }),
      configs,
    };
  }
  return withLock(bundle.spec.stateDirectory, 'deploy bundle', async () => {
    setProjectId(bundle.spec.composeProject);
    const preview = await runtime({ ...runtimeOptions, dryRun: true });
    const receiptPath = join(
      bundle.spec.stateDirectory,
      '.tale',
      'deployment-ready.json',
    );
    const intentPath = join(
      bundle.spec.stateDirectory,
      '.tale',
      'deployment-pending.json',
    );
    let intent = existsSync(intentPath)
      ? deploymentIntentSchema.parse(
          JSON.parse(readRegular(intentPath).toString('utf8')),
        )
      : undefined;
    if (
      intent &&
      (intent.name !== bundle.spec.name || intent.bundleSha256 !== bundleSha256)
    )
      throw preconditionError(
        'A different deployment bundle is pending. Recover the same reviewed bundle first.',
      );
    const previous = existsSync(receiptPath)
      ? z
          .object({
            schemaVersion: z.literal(1),
            phase: z.literal('ready'),
            name: z.literal(bundle.spec.name),
            bundleSha256: sha,
            snapshotId: z.string().refine(isValidSnapshotId).optional(),
          })
          .parse(JSON.parse(readRegular(receiptPath).toString('utf8')))
      : undefined;
    let snapshot = intent?.snapshot;
    if (
      !intent &&
      preview.existing &&
      (preview.changed || previous?.bundleSha256 !== bundleSha256)
    ) {
      const created = await (dependencies.snapshot ?? createSnapshot)({
        prefix: `${bundle.spec.composeProject}_`,
        trigger: 'deploy',
        platformVersion: null,
      });
      if (!created)
        throw preconditionError(
          'Existing deployment has no verified recovery snapshot.',
        );
      snapshot = recoverySnapshotSchema.parse(created);
    }
    if (snapshot)
      await (dependencies.verifySnapshot ?? verifySnapshot)(
        `${bundle.spec.composeProject}_`,
        snapshot,
      );
    // Persist the original recovery point before any runtime or native write.
    // Retrying a failed deployment must never substitute a snapshot of its
    // partially applied state for the pre-deployment snapshot.
    if (!intent) {
      intent = {
        schemaVersion: 1,
        phase: 'pending',
        name: bundle.spec.name,
        bundleSha256,
        snapshot,
      };
      atomicRuntimeFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    }
    const applied = await runtime(runtimeOptions);
    const native = await provisionBackend(
      bundle,
      directory,
      applied,
      configs,
      dependencies,
    );
    const receipt = {
      schemaVersion: 1,
      phase: 'ready',
      name: bundle.spec.name,
      revision: runtimeBundle.revision,
      cliRevision: bundle.cli.revision,
      deploymentRef: bundle.deploymentRef,
      bundleSha256,
      images: applied.images,
      configs,
      native,
      snapshotId:
        snapshot?.id ??
        (previous?.bundleSha256 === bundleSha256
          ? previous.snapshotId
          : undefined),
    };
    atomicRuntimeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await unlink(intentPath);
    return { ...receipt, dryRun: false, runtimeChanged: applied.changed };
  });
}
