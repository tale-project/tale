import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { sha256, stableJson } from '../config/releases/identity';
import { withLock } from '../state/with-lock';
import { withFrozenDeployment, type DeploymentBundle } from './bundle';
import {
  publishClientExport,
  validateClientExportDirectory,
} from './client-export-files';
import {
  clientConsumerSchema,
  clientExportTargetSchema,
  type ClientExportTarget,
} from './client-export-model';
import { stateSchema as attestationStateSchema } from './email-attestation';
import { bootstrapSchema } from './identity';
import {
  assertNativeClientPolicy,
  createBackendNativeClients,
  existingSchema,
  identifier,
  intentSchema,
  withBackendAuth,
  type BackendAdapterOptions,
  type ClientIntent,
} from './native-client';
import {
  nativeDeploymentStateDirectory,
  provisionStatePath,
  readProvisionStateProof,
} from './provision-state';

type ReadCall = (...args: unknown[]) => Promise<unknown>;
const callable = z.custom<ReadCall>((value) => typeof value === 'function');
const contextSchema = z.object({
  adapter: z.object({ findOne: callable, findMany: callable }),
  internalAdapter: z.object({ findUserById: callable }),
});
const nativeClientSchema = z.object({
  clientId: identifier,
  clientSecret: z.string().min(1).max(1024),
  referenceId: identifier,
  softwareId: identifier,
  name: z.string(),
  redirectUris: z.array(z.string()),
  disabled: z.boolean(),
  requirePKCE: z.boolean(),
  skipConsent: z.boolean(),
  public: z.literal(false),
  tokenEndpointAuthMethod: z.string(),
  grantTypes: z.array(z.string()),
  responseTypes: z.array(z.string()),
  scopes: z.array(z.string()),
  type: z.string(),
  metadata: z.unknown(),
  expiresAt: z.null().optional(),
});
export type ClientExportVerifier = (
  target: ClientExportTarget,
  intent: ClientIntent,
) => Promise<string>;
/** Supported native adapter reads and tokenless introspection. No public route,
 * administrator session, creation, secret rotation or raw SQL is introduced. */
export function createBackendClientExportVerifier(
  options: BackendAdapterOptions,
): ClientExportVerifier {
  return async (target, intent) => {
    let fingerprint: string | undefined;
    try {
      await withBackendAuth(options, async (auth) => {
        const context = contextSchema.parse(await auth.$context);
        const user = z
          .object({
            id: identifier,
            email: z.email(),
            emailVerified: z.boolean(),
            banned: z.boolean().nullable().optional(),
          })
          .parse(await context.internalAdapter.findUserById(target.userId));
        if (
          user.id !== target.userId ||
          user.banned === true ||
          (target.email &&
            user.email.toLowerCase() !== target.email.toLowerCase()) ||
          (target.emailVerification && !user.emailVerified)
        )
          throw Error('Native operator identity differs');
        const organization = z
          .object({ id: identifier, slug: z.string(), name: z.string() })
          .parse(
            await context.adapter.findOne({
              model: 'organization',
              where: [
                { field: 'id', value: target.organization.id },
                { field: 'slug', value: target.organization.slug },
              ],
            }),
          );
        if (stableJson(organization) !== stableJson(target.organization))
          throw Error('Native organization identity differs');
        const members = z
          .array(
            z.object({
              organizationId: identifier,
              userId: identifier,
              role: z.string(),
            }),
          )
          .length(1)
          .parse(
            await context.adapter.findMany({
              model: 'member',
              where: [
                { field: 'organizationId', value: target.organization.id },
                { field: 'userId', value: target.userId },
              ],
              limit: 2,
            }),
          );
        const member = members[0];
        if (
          member.organizationId !== target.organization.id ||
          member.userId !== target.userId ||
          !['owner', 'admin'].includes(member.role.toLowerCase())
        )
          throw Error('Native operator membership differs');
        const matches = z
          .array(nativeClientSchema)
          .length(1)
          .parse(
            await context.adapter.findMany({
              model: 'oauthClient',
              where: [
                { field: 'referenceId', value: target.organization.id },
                { field: 'softwareId', value: target.client.key },
              ],
              limit: 2,
            }),
          );
        const client = matches[0];
        const metadata = z
          .object({ taleOrganizationId: identifier })
          .parse(
            typeof client.metadata === 'string'
              ? JSON.parse(client.metadata)
              : client.metadata,
          );
        const projected = existingSchema.parse({
          software_id: client.softwareId,
          client_id: client.clientId,
          client_name: client.name,
          redirect_uris: client.redirectUris,
          disabled: client.disabled,
          require_pkce: client.requirePKCE,
          skip_consent: client.skipConsent,
          token_endpoint_auth_method: client.tokenEndpointAuthMethod,
          grant_types: client.grantTypes,
          response_types: client.responseTypes,
          scope: client.scopes.join(' '),
          type: client.type,
          taleOrganizationId: metadata.taleOrganizationId,
        });
        assertNativeClientPolicy(projected, target.organization.id);
        if (
          client.referenceId !== target.organization.id ||
          client.softwareId !== target.client.key ||
          client.clientId !== intent.credentials.clientId ||
          client.clientId !== target.client.clientId ||
          client.name !== target.client.name ||
          stableJson(client.redirectUris) !==
            stableJson(target.client.redirectUris)
        )
          throw Error('Native client identity differs');
        // Hash the stored secret as part of the private read fingerprint, never
        // return the native row or secret hash in a public receipt.
        fingerprint = sha256(
          stableJson({ user, organization, member, client }),
        );
      });
      await createBackendNativeClients(options).verify(intent.credentials);
    } catch {
      throw externalDepError(
        'Native credential export verification failed; no credentials were changed.',
      );
    }
    if (!fingerprint)
      throw externalDepError('Native credential export proof is missing.');
    return fingerprint;
  };
}
export function verifyClientExportTarget(
  bundle: DeploymentBundle,
  identity: string,
  raw: unknown,
): ClientExportTarget {
  const result = clientExportTargetSchema.safeParse(raw);
  if (!result.success)
    throw preconditionError('Invalid credential export selection.');
  const target = result.data;
  const desired = bundle.spec.identity?.nativeClients.find(
    (client) => client.key === target.client.key,
  );
  if (
    !desired?.managed ||
    target.deployment.bundleSha256 !== identity ||
    target.deployment.name !== bundle.spec.name ||
    target.deployment.cliRevision !== bundle.cli.revision ||
    target.deployment.deploymentRef !== bundle.deploymentRef ||
    target.deployment.runtimeRevision !== bundle.spec.runtime.revision ||
    target.origin !== bundle.spec.origin ||
    target.organization.slug !== bundle.spec.identity?.slug ||
    target.organization.name !== bundle.spec.identity.name ||
    target.client.name !== desired.name ||
    stableJson(target.client.redirectUris) !==
      stableJson(desired.redirectUris) ||
    (typeof bundle.spec.identity.email === 'string' &&
      target.email?.toLowerCase() !==
        bundle.spec.identity.email.toLowerCase()) ||
    (bundle.spec.identity.emailVerification
      ? !target.emailVerification ||
        target.emailVerification.userId !== target.userId ||
        target.emailVerification.email !== target.email
      : target.emailVerification !== undefined)
  )
    throw preconditionError(
      'Credential export selection differs from the frozen deployment.',
    );
  return target;
}
export async function exportNativeClient(
  directory: string,
  raw: unknown,
  output: string,
  dependencies: { dataDirectory?: string; verify?: ClientExportVerifier } = {},
) {
  return withFrozenDeployment(directory, {}, async (frozen, bundle) => {
    const target = verifyClientExportTarget(
      bundle,
      sha256(readFileSync(join(frozen, 'deployment.json'))),
      raw,
    );
    validateClientExportDirectory(output);
    const state = nativeDeploymentStateDirectory(
      dependencies.dataDirectory ?? '/app/data',
      bundle.spec.name,
      false,
    );
    return withLock(state, 'deploy export-client native', async () => {
      const file = provisionStatePath(
        state,
        `client-${target.client.key}.json`,
      );
      const retained = readProvisionStateProof(file, intentSchema);
      if (
        !retained ||
        retained.sha256 !== target.client.credentialsSha256 ||
        retained.value.phase !== 'ready' ||
        retained.value.origin !== target.origin ||
        retained.value.organizationId !== target.organization.id ||
        retained.value.operatorUserId !== target.userId ||
        retained.value.body.software_id !== target.client.key ||
        retained.value.body.metadata.taleOrganizationId !==
          target.organization.id ||
        retained.value.credentials.clientId !== target.client.clientId
      )
        throw preconditionError(
          'Credential export requires the exact completed native client intent.',
        );
      let identityFile: string | undefined, identityHash: string | undefined;
      let expectedEmail = target.email;
      if (bundle.spec.identity?.bootstrap === 'fresh') {
        identityFile = provisionStatePath(state, 'bootstrap.json');
        const bootstrap = readProvisionStateProof(
          identityFile,
          bootstrapSchema,
        );
        if (
          !bootstrap ||
          bootstrap.value.phase !== 'ready' ||
          bootstrap.value.origin !== target.origin ||
          bootstrap.value.userId !== target.userId ||
          bootstrap.value.organizationId !== target.organization.id ||
          bootstrap.value.slug !== target.organization.slug ||
          bootstrap.value.name !== target.organization.name ||
          (target.email && bootstrap.value.email !== target.email) ||
          bootstrap.value.emailVerification !==
            bundle.spec.identity.emailVerification
        )
          throw preconditionError(
            'Credential export bootstrap identity is incomplete or changed.',
          );
        identityHash = bootstrap.sha256;
        expectedEmail = bootstrap.value.email;
      }
      let attestationFile: string | undefined;
      if (target.emailVerification) {
        attestationFile = provisionStatePath(state, 'email-attestation.json');
        const attestation = readProvisionStateProof(
          attestationFile,
          attestationStateSchema,
        );
        if (
          !attestation ||
          attestation.value.phase !== 'ready' ||
          attestation.sha256 !== target.emailVerification.receipt.sha256 ||
          target.emailVerification.receipt.path !== attestationFile ||
          attestation.value.userId !== target.userId ||
          attestation.value.email !== target.email ||
          attestation.value.origin !== target.origin
        )
          throw preconditionError(
            'Credential export email attestation differs from its completed proof.',
          );
      }
      const verify =
        dependencies.verify ??
        createBackendClientExportVerifier({ origin: target.origin });
      const currentTarget = {
        ...target,
        ...(expectedEmail ? { email: expectedEmail } : {}),
      };
      const before = await verify(currentTarget, retained.value);
      const after = await verify(currentTarget, retained.value);
      if (
        before !== after ||
        readProvisionStateProof(file, intentSchema)?.sha256 !==
          retained.sha256 ||
        (identityFile &&
          readProvisionStateProof(identityFile, bootstrapSchema)?.sha256 !==
            identityHash) ||
        (attestationFile &&
          readProvisionStateProof(attestationFile, attestationStateSchema)
            ?.sha256 !== target.emailVerification?.receipt.sha256)
      )
        throw preconditionError(
          'Native credential or identity changed during export verification.',
        );
      const consumer = clientConsumerSchema.parse({
        schemaVersion: 1,
        kind: 'tale-oidc-client',
        deployment: target.deployment,
        issuer: `${target.origin}/api/auth`,
        organizationId: target.organization.id,
        organizationSlug: target.organization.slug,
        clientKey: target.client.key,
        ...retained.value.credentials,
        redirectUris: target.client.redirectUris,
      });
      return publishClientExport(output, target, consumer);
    });
  });
}
