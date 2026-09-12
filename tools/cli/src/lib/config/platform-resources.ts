import { brandingFormSchema } from '@tale/shared/schemas/branding';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import { POLICY_SCHEMAS } from '@tale/shared/schemas/governance';
import { knowledgeEmbeddingSchema } from '@tale/shared/schemas/knowledge';
import {
  modelCatalogFileSchema,
  providerCredentialMetadataSchema,
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '@tale/shared/schemas/providers';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { PlatformConfigurationClient } from './platform-client';
import {
  resourceId,
  sameConfiguration,
  type PlatformResource,
} from './platform-model';

export interface ResourceObservation {
  config: unknown;
  revision: string | null;
  credentialId?: string;
}
const hash = expectedConfigurationHashSchema;
const credentials = z.object({
  credentials: z.array(providerCredentialMetadataSchema).max(10_000),
});

/** These adapters describe native API differences, not a second config store.
 * Permissions, locks, audit, cache invalidation and side effects stay native. */
export async function readResource(
  client: PlatformConfigurationClient,
  resource: PlatformResource,
): Promise<ResourceObservation> {
  switch (resource.kind) {
    case 'provider': {
      const view = z
        .object({ config: providerDefinitionSchema.nullable(), hash })
        .parse(
          await client.request(
            `/api/app/providers/definitions/${encodeURIComponent(resource.config.name)}`,
          ),
        );
      return { config: view.config, revision: view.hash };
    }
    case 'branding': {
      const view = z
        .object({ config: brandingFormSchema.nullable(), hash })
        .parse(await client.request('/api/app/branding/config'));
      return { config: view.config, revision: view.hash };
    }
    case 'deployment': {
      const view = z
        .object({ config: deploymentConfigSchema, hash, canEdit: z.boolean() })
        .parse(await client.request('/api/app/deployment/config'));
      if (!view.canEdit && !sameConfiguration(view.config, resource.config))
        throw preconditionError(
          'The native deployment editor allowlist does not authorize this instance change.',
        );
      return { config: view.config, revision: view.hash };
    }
    case 'governance': {
      const view = z
        .object({
          policy: z
            .object({
              key: z.literal(resource.key),
              config: POLICY_SCHEMAS[resource.key],
            })
            .nullable(),
          hash,
        })
        .parse(
          await client.request(
            `/api/app/governance/policies/${resource.key}?includeHash=1`,
          ),
        );
      return { config: view.policy?.config ?? null, revision: view.hash };
    }
    case 'knowledge-embedding': {
      const view = z
        .object({ config: knowledgeEmbeddingSchema.nullable(), hash })
        .parse(await client.request('/api/app/knowledge/embedding'));
      return { config: view.config, revision: view.hash };
    }
    case 'provider-credential': {
      const rows = credentials.parse(
        await client.request('/api/app/provider-credentials/'),
      ).credentials;
      const matches = rows.filter(
        (row) =>
          row.providerSlug === resource.config.providerSlug &&
          row.name === resource.config.name,
      );
      if (matches.length > 1)
        throw preconditionError(
          'A declared credential name is ambiguous within its provider.',
        );
      const current = matches[0];
      if (current && current.authMethod !== 'env')
        throw preconditionError(
          'An existing credential uses another authentication method; its secret was preserved.',
        );
      return {
        config: current
          ? providerEnvironmentCredentialSchema.parse({
              providerSlug: current.providerSlug,
              authMethod: current.authMethod,
              name: current.name,
              envName: current.envName,
              endpointUrl: current.endpointUrl,
              modelAllowlist: current.modelAllowlist,
              status: current.status,
              isDefault: current.isDefault,
            })
          : null,
        revision: current?.hash ?? null,
        ...(current ? { credentialId: current.id } : {}),
      };
    }
  }
}

/** Check side effects before any resource is written. A changed vector space
 * cannot be admitted merely because its new dimensions parse successfully. */
export async function checkResourceChange(
  client: PlatformConfigurationClient,
  resource: PlatformResource,
  current: ResourceObservation,
  declaredResources: readonly PlatformResource[] = [],
) {
  if (sameConfiguration(current.config, resource.config)) return;
  if (resource.kind === 'provider-credential' && resource.config.isDefault) {
    const rows = credentials.parse(
      await client.request('/api/app/provider-credentials/'),
    ).credentials;
    for (const row of rows) {
      if (
        row.providerSlug !== resource.config.providerSlug ||
        row.id === current.credentialId ||
        !row.isDefault
      )
        continue;
      // Clearing an existing default changes another resource. The reviewed
      // declaration must name that change; apply orders it before the new default.
      const replacement = declaredResources.find(
        (entry) =>
          entry.kind === 'provider-credential' &&
          entry.config.providerSlug === row.providerSlug &&
          entry.config.name === row.name &&
          !entry.config.isDefault,
      );
      if (row.authMethod !== 'env' || !replacement)
        throw preconditionError(
          'Selecting a default credential requires an explicit declaration clearing the existing default.',
        );
    }
  }
  if (resource.kind === 'knowledge-embedding') {
    // The hub listing omits project and other-team documents. Native aggregates
    // include the whole organization; crawled websites use the same embedding
    // configuration. Operators must pause ingestion during a model change.
    const count = z.object({ count: z.number().int().nonnegative() });
    const observations = await Promise.all([
      client.request('/api/app/documents/approx-count'),
      client.request('/api/app/websites/count'),
    ]);
    if (observations.some((value) => count.parse(value).count !== 0))
      throw preconditionError(
        'Changing embedding configuration requires an empty document corpus and no registered websites, or the dedicated native indexing migration.',
      );
  }
}

export async function writeResource(
  client: PlatformConfigurationClient,
  resource: PlatformResource,
  current: ResourceObservation,
): Promise<void> {
  const expectedHash = current.revision;
  switch (resource.kind) {
    case 'provider':
      await client.request(
        `/api/app/providers/definitions/${encodeURIComponent(resource.config.name)}`,
        'PUT',
        { config: resource.config, expectedHash },
      );
      return;
    case 'branding':
      await client.request('/api/app/branding/save', 'POST', {
        ...resource.config,
        expectedHash,
      });
      return;
    case 'deployment':
      await client.request('/api/app/deployment/config', 'POST', {
        config: resource.config,
        expectedHash,
      });
      return;
    case 'governance':
      await client.request(
        `/api/app/governance/policies/${resource.key}`,
        'POST',
        { config: resource.config, expectedHash },
      );
      return;
    case 'knowledge-embedding': {
      const result = z
        .object({ ok: z.literal(true), requeued: z.literal(0) })
        .safeParse(
          await client.request('/api/app/knowledge/embedding', 'POST', {
            ...resource.config,
            expectedHash,
          }),
        );
      if (!result.success)
        throw preconditionError(
          'Embedding setup observed unexpected indexing work; inspect native status before retrying.',
        );
      return;
    }
    case 'provider-credential': {
      const {
        providerSlug,
        authMethod,
        endpointUrl,
        modelAllowlist,
        ...fields
      } = resource.config;
      if (current.credentialId) {
        await client.request(
          `/api/app/provider-credentials/${encodeURIComponent(current.credentialId)}`,
          'POST',
          {
            ...fields,
            endpointUrl,
            modelAllowlist,
            expectedHash,
          },
        );
      } else {
        await client.request('/api/app/provider-credentials/', 'POST', {
          ...fields,
          providerSlug,
          authMethod,
          ...(endpointUrl === null ? {} : { endpointUrl }),
          ...(modelAllowlist === null ? {} : { modelAllowlist }),
          expectedHash: null,
        });
        // Native creation must honor the explicit status/default in one write.
        // Do not transiently activate a credential and repair it afterward.
        const created = await readResource(client, resource);
        if (
          !created.credentialId ||
          !sameConfiguration(created.config, resource.config)
        )
          throw preconditionError(
            'Native credential creation did not preserve the declared metadata.',
          );
      }
      return;
    }
  }
}

/** Optional provider catalog assertions use Tale's fresh native resolver.
 * There is no CLI endpoint fetcher, vendor inference or static fallback. */
export async function verifyResource(
  client: PlatformConfigurationClient,
  resource: PlatformResource,
): Promise<ResourceObservation> {
  const actual = await readResource(client, resource);
  if (!sameConfiguration(actual.config, resource.config))
    throw preconditionError(
      `Native configuration did not converge for ${resourceId(resource)}.`,
    );
  if (resource.kind === 'provider' && resource.expectedModels) {
    const view = z
      .object({ models: modelCatalogFileSchema })
      .parse(
        await client.request(
          `/api/app/providers/definitions/${encodeURIComponent(resource.config.name)}/catalog`,
        ),
      );
    const sorted = (models: z.infer<typeof modelCatalogFileSchema>) =>
      [...models].sort((a, b) => a.id.localeCompare(b.id));
    if (
      !sameConfiguration(sorted(view.models), sorted(resource.expectedModels))
    )
      throw preconditionError(
        'The native provider catalog differs from its declared model capabilities.',
      );
  }
  return actual;
}
