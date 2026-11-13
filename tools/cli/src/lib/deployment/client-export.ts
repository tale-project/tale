import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { sha256, stableJson } from '../config/releases/identity';
import { gitSha, sha, slug } from '../config/releases/model';
import type { exec } from '../docker/exec';
import type { IncusRuntime } from '../runtime/incus/incus-runtime';
import { validateLockPaths } from '../state/lock-guard';
import { withLock } from '../state/with-lock';
import { backendCliFailure, backendDataOwner } from './backend-cli';
import { withFrozenDeployment, type DeploymentBundle } from './bundle';
import {
  publishClientExport,
  validateClientExportDirectory,
  verifyClientExportDirectory,
} from './client-export-files';
import {
  clientExportResultSchema,
  clientExportTargetSchema,
  exportPrefixSchema,
  type ClientExportTarget,
} from './client-export-model';
import { verifyClientExportTarget } from './client-export-native';
import { nativeProvisionProofSchema } from './native-proof';
import { readProvisionStateProof } from './provision-state';
import { observeReadyRuntime } from './runtime-apply';
import {
  deploymentAccess,
  incusDeclarationOf,
  observeReadyIncusRuntime,
  type DeploymentRuntimeSpec,
} from './runtime-incus-apply';
import { readRuntimeBundle, runtimeImageSchema } from './runtime-model';

export interface ExportClientOptions {
  bundle: string;
  client: string;
  output: string;
  envPrefix?: string;
  cliRef?: string;
  deploymentRef?: string;
}
const readySchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal('ready'),
  name: slug,
  revision: gitSha,
  cliRevision: gitSha,
  deploymentRef: gitSha.optional(),
  bundleSha256: sha,
  images: z.array(runtimeImageSchema),
  native: nativeProvisionProofSchema,
});
function requireAbsent(file: string) {
  try {
    lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw preconditionError(
    'An unfinished deployment prevents credential export.',
  );
}
function selectTarget(
  bundle: DeploymentBundle,
  directory: string,
  options: ExportClientOptions,
) {
  const identity = bundle.spec.identity;
  const desired = identity?.nativeClients.find(
    (client) => client.key === options.client,
  );
  if (!identity || !desired?.managed)
    throw preconditionError(
      'Select one explicitly managed native client from this deployment.',
    );
  requireAbsent(
    join(bundle.spec.stateDirectory, '.tale', 'deployment-pending.json'),
  );
  const file = join(
    bundle.spec.stateDirectory,
    '.tale',
    'deployment-ready.json',
  );
  const proof = readProvisionStateProof(file, readySchema, 1_048_576);
  const bundleSha256 = sha256(readFileSync(join(directory, 'deployment.json')));
  const runtime = readRuntimeBundle(join(directory, 'runtime')).bundle;
  if (
    !proof ||
    proof.value.name !== bundle.spec.name ||
    proof.value.bundleSha256 !== bundleSha256 ||
    proof.value.cliRevision !== bundle.cli.revision ||
    proof.value.deploymentRef !== bundle.deploymentRef ||
    proof.value.revision !== bundle.spec.runtime.revision ||
    stableJson(proof.value.images) !== stableJson(runtime.images) ||
    proof.value.native.organizationSlug !== identity.slug ||
    proof.value.native.ssoEnabled !== identity.ssoEnabled ||
    proof.value.native.nativeClients.length !== identity.nativeClients.length ||
    new Set(proof.value.native.nativeClients.map((c) => c.key)).size !==
      identity.nativeClients.length
  )
    throw preconditionError(
      'Credential export requires this exact completed deployment receipt.',
    );
  const native = proof.value.native;
  const matches = native.nativeClients.filter(
    (client) => client.key === desired.key,
  );
  const client = matches[0];
  if (
    matches.length !== 1 ||
    !client?.credentials ||
    client.credentials.path !==
      `/app/data/ops/tale-deployments/${bundle.spec.name}/private/client-${desired.key}.json`
  )
    throw preconditionError(
      'The ready deployment has no exact managed client credential proof.',
    );
  const email =
    typeof identity.email === 'string'
      ? identity.email.toLowerCase()
      : native.emailVerification?.email;
  const target = clientExportTargetSchema.parse({
    schemaVersion: 1,
    deployment: {
      name: bundle.spec.name,
      bundleSha256,
      readyReceiptSha256: proof.sha256,
      cliRevision: bundle.cli.revision,
      runtimeRevision: runtime.revision,
      ...(bundle.deploymentRef ? { deploymentRef: bundle.deploymentRef } : {}),
    },
    origin: bundle.spec.origin,
    organization: {
      id: native.organizationId,
      slug: native.organizationSlug,
      name: identity.name,
    },
    userId: native.userId,
    ...(email ? { email } : {}),
    ...(native.emailVerification
      ? { emailVerification: native.emailVerification }
      : {}),
    client: {
      key: desired.key,
      name: desired.name,
      redirectUris: desired.redirectUris,
      clientId: client.clientId,
      credentialsSha256: client.credentials.sha256,
    },
    ...(options.envPrefix ? { envPrefix: options.envPrefix } : {}),
  });
  verifyClientExportTarget(bundle, bundleSha256, target);
  return { target, file };
}
/** The most file content a credential export may hand back: a receipt and
 * a consumer's credentials, never close to it. */
const CLIENT_EXPORT_MAX_BYTES = 8 * 1024 * 1024;
async function readBackendExport(
  directory: string,
  backend: string,
  target: ClientExportTarget,
  receive: string,
  run: typeof exec | undefined,
  spec: DeploymentRuntimeSpec,
  images: readonly string[],
  incusRuntime: IncusRuntime | undefined,
) {
  const temporary = `/tmp/tale-client-export-${randomUUID()}`;
  const runtime = await deploymentAccess(
    spec,
    {
      bounds: () => ({ timeout: 120 }),
      failed: () =>
        externalDepError('The backend-local credential export could not run.'),
      refused: (result) =>
        externalDepError(
          backendCliFailure(
            'The backend-local credential export did not complete.',
            result,
          ),
        ),
    },
    { exec: run },
    images,
    incusRuntime,
  );
  // Same account as `deploy provision`: the export reads the private state
  // that phase wrote, owned by the backend's own user.
  const owner = await backendDataOwner(runtime, backend);
  await runtime.exec(backend, ['mkdir', '-m', '700', temporary]);
  try {
    await runtime.copyIn(backend, { directory }, temporary);
    await runtime.exec(backend, ['chown', '-R', owner, temporary]);
    const result = await runtime.exec(
      backend,
      [
        // Interpreted, under the backend container's own bun — like
        // `deploy provision`. The native export imports the backend's own
        // db/auth modules (withBackendAuth), which import node_modules a
        // compiled executable cannot resolve from the backend's filesystem;
        // the interpreted bundle beside the executable resolves them.
        'bun',
        `${temporary}/cli/tale.mjs`,
        'deploy',
        'export-client-native',
        '--bundle',
        temporary,
        '--output',
        `${temporary}/export-output`,
        '--json',
      ],
      { stdin: JSON.stringify(target), workdir: '/', user: owner },
    );
    if (Buffer.byteLength(result.stdout, 'utf8') > 65536)
      throw externalDepError(
        'Native credential export returned an oversized receipt.',
      );
    let parsed;
    try {
      parsed = z
        .object({
          ok: z.literal(true),
          command: z.literal('deploy export-client-native'),
          data: clientExportResultSchema,
        })
        .parse(JSON.parse(result.stdout));
    } catch {
      throw externalDepError(
        'Native credential export did not return a bounded public receipt.',
      );
    }
    if (
      parsed.data.directory !== `${temporary}/export-output` ||
      stableJson(parsed.data.receipt.target) !== stableJson(target)
    )
      throw preconditionError(
        'Native credential export returned a different target.',
      );
    await runtime.copyOut(backend, `${temporary}/export-output`, receive, {
      maxBytes: CLIENT_EXPORT_MAX_BYTES,
    });
    const actual = verifyClientExportDirectory(receive, target);
    if (
      stableJson(actual.result.receipt) !== stableJson(parsed.data.receipt) ||
      stableJson(actual.result.receiptFile) !==
        stableJson(parsed.data.receiptFile)
    )
      throw preconditionError(
        'Transferred credential artifacts differ from their native receipt.',
      );
    return actual.consumer;
  } finally {
    let cleaned = false;
    try {
      cleaned = (
        await runtime.exec(backend, ['rm', '-rf', temporary], {
          allowFailure: true,
        })
      ).success;
    } catch {
      /* Preserve the primary safe error. */
    }
    if (!cleaned)
      logger.warn(
        'The private backend credential-export temporary directory could not be removed.',
      );
  }
}
/** Export only an already-ready exact managed client. The runtime is observed,
 * never applied; credentials leave the backend only through a private artifact. */
export async function exportManagedClient(
  options: ExportClientOptions,
  dependencies: {
    exec?: typeof exec;
    observe?: typeof observeReadyRuntime;
    /** The stack's Incus runtime (tests). */
    incusRuntime?: IncusRuntime;
  } = {},
) {
  if (
    !slug.safeParse(options.client).success ||
    (options.envPrefix !== undefined &&
      !exportPrefixSchema.safeParse(options.envPrefix).success)
  )
    throw preconditionError(
      'Invalid credential client key or environment prefix.',
    );
  validateClientExportDirectory(options.output);
  return withFrozenDeployment(
    options.bundle,
    options,
    async (directory, bundle) => {
      if (!(await validateLockPaths(bundle.spec.stateDirectory)))
        throw preconditionError(
          'Credential export requires an existing deployment state directory.',
        );
      // Read once before acquisition so a missing ready destination is never
      // initialized merely to export credentials. Read again under the lock.
      selectTarget(bundle, directory, options);
      return withLock(
        bundle.spec.stateDirectory,
        'deploy export-client',
        async () => {
          const { target, file } = selectTarget(bundle, directory, options);
          if (validateClientExportDirectory(options.output))
            verifyClientExportDirectory(options.output, target);
          const observe =
            dependencies.observe ??
            (bundle.spec.runtime.engine === 'incus'
              ? (
                  input: Parameters<typeof observeReadyRuntime>[0],
                ): ReturnType<typeof observeReadyRuntime> =>
                  observeReadyIncusRuntime(
                    {
                      ...input,
                      incus: incusDeclarationOf(bundle.spec),
                      ...(bundle.spec.sandbox?.egressProxy === undefined
                        ? {}
                        : { egressProxy: bundle.spec.sandbox.egressProxy }),
                    },
                    dependencies.incusRuntime === undefined
                      ? {}
                      : { incusRuntime: dependencies.incusRuntime },
                  )
              : observeReadyRuntime);
          const runtime = await observe(
            {
              bundleDirectory: join(directory, 'runtime'),
              stateDirectory: bundle.spec.stateDirectory,
              composeProject: bundle.spec.composeProject,
              name: bundle.spec.name,
              origin: bundle.spec.origin,
              ...(bundle.spec.additionalOrigins
                ? { additionalOrigins: bundle.spec.additionalOrigins }
                : {}),
              tlsMode: bundle.spec.tlsMode,
              tlsEmail: bundle.spec.tlsEmail,
            },
            { exec: dependencies.exec },
          );
          if (
            !runtime.backendContainer ||
            runtime.revision !== target.deployment.runtimeRevision
          )
            throw preconditionError(
              'The exact healthy backend is unavailable for credential export.',
            );
          const receive = await realpath(
            await mkdtemp(join(tmpdir(), 'tale-client-receive-')),
          );
          await chmod(receive, 0o700);
          // The receive root itself has a public system parent; give the private
          // artifact verifier an explicitly private parent, exactly like output.
          const received = join(receive, 'artifact');
          await mkdir(received, { mode: 0o700 });
          try {
            const consumer = await readBackendExport(
              directory,
              runtime.backendContainer,
              target,
              received,
              dependencies.exec,
              bundle.spec,
              runtime.images.map((image) => image.reference),
              dependencies.incusRuntime,
            );
            requireAbsent(
              join(
                bundle.spec.stateDirectory,
                '.tale',
                'deployment-pending.json',
              ),
            );
            if (
              readProvisionStateProof(file, readySchema, 1_048_576)?.sha256 !==
              target.deployment.readyReceiptSha256
            )
              throw preconditionError(
                'Ready deployment changed during credential export.',
              );
            return publishClientExport(options.output, target, consumer);
          } finally {
            await rm(receive, { recursive: true, force: true });
          }
        },
      );
    },
  );
}
