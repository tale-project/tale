import {
  convergedWithHash,
  resourceConverged,
  resourceId,
  sameConfiguration,
  sameEmbeddingModel,
  type PlatformResource,
} from '@tale/shared/config/platform-resources';
import { brandingFormSchema } from '@tale/shared/schemas/branding';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import { POLICY_SCHEMAS } from '@tale/shared/schemas/governance';
import { knowledgeEmbeddingSchema } from '@tale/shared/schemas/knowledge';
import type { ManagedDispatchPlan } from '@tale/shared/schemas/managed-configuration';
import {
  modelCatalogFileSchema,
  providerCredentialMetadataSchema,
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '@tale/shared/schemas/providers';
import { configurationHash } from '@tale/shared/utils/configuration-hash';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { isSecretResource, type DeclaredSecrets } from './declared-secrets';
import {
  checkManagedResource,
  isManagedResource,
  readManagedResource,
  writeManagedResource,
} from './managed-resources';
import type { PlatformConfigurationClient } from './platform-client';

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
  if (isManagedResource(resource)) return readManagedResource(client, resource);
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
        await client.request('/api/app/provider-credentials'),
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

/**
 * Whether the native state already IS what the declaration asks for. A
 * declared secret compares what the platform reads back of it — its
 * identity and the digest of the value it holds — with the same for the
 * value its environment holds now, so a changed value reads as a change
 * although the declaration, which names only where the value comes from,
 * did not change. Every other kind compares its declaration
 * (`resourceConverged`).
 */
export function converged(
  resource: PlatformResource,
  current: ResourceObservation,
  secrets: DeclaredSecrets,
): boolean {
  if (isSecretResource(resource))
    return convergedWithHash(
      resource.kind,
      current.config,
      configurationHash(secrets.desired(resource)),
    );
  return resourceConverged(resource, current.config);
}

/** What a change is checked against besides the resource itself. */
export interface ChangeContext {
  secrets: DeclaredSecrets;
  /** The whole declaration, while nothing of it is written yet: a check may
   * then count what it creates. Left out once writing began, when what the
   * declaration creates exists and is read as it is. */
  declared?: readonly PlatformResource[];
  /** The resources the declaration creates that do not exist yet, by id. */
  absent?: ReadonlySet<string>;
}

/** What a declaration creates in a dispatch's project and the dispatch
 * names, for the platform's check of the dispatch before any of it exists;
 * undefined when it creates nothing there. Only what the dispatch names is
 * sent, so the plan stays within the dispatch's own bounds however many
 * agents, tasks and labels the declaration creates. */
function plannedForDispatch(
  dispatch: Extract<PlatformResource, { kind: 'project-dispatch' }>['config'],
  context: ChangeContext,
): ManagedDispatchPlan | undefined {
  const { projectId } = dispatch;
  const roles = dispatch.standingRoles ?? [];
  const namedAgents = new Set([
    ...dispatch.agents,
    ...roles.map((role) => role.agentId),
    ...(dispatch.reviewers ?? []),
  ]);
  const namedTasks = new Set(roles.map((role) => role.taskId));
  const namedLabels = new Set(
    [
      ...(dispatch.labels?.include ?? []),
      ...(dispatch.labels?.exclude ?? []),
      ...(dispatch.gates ?? []).flatMap((gate) => gate.labels ?? []),
    ].map((name) => name.toLowerCase()),
  );
  const created = (context.declared ?? []).filter(
    (entry) =>
      'createIfMissing' in entry &&
      entry.createIfMissing === true &&
      'projectId' in entry.config &&
      entry.config.projectId === projectId,
  );
  const unique = (values: string[]) => [...new Set(values)];
  const planned: ManagedDispatchPlan = {
    agents: unique(
      created.flatMap((entry) =>
        entry.kind === 'project-agent' && namedAgents.has(entry.config.agentId)
          ? [entry.config.agentId]
          : [],
      ),
    ),
    tasks: unique(
      created.flatMap((entry) =>
        (entry.kind === 'task' || entry.kind === 'task-review-context') &&
        namedTasks.has(entry.config.taskId)
          ? [entry.config.taskId]
          : [],
      ),
    ),
    labels: created.flatMap((entry) =>
      entry.kind === 'project-label' &&
      namedLabels.has(entry.config.name.toLowerCase())
        ? [entry.config.name]
        : [],
    ),
    ...(context.absent?.has(`project/${projectId}`) === true
      ? { project: true as const }
      : {}),
  };
  return planned.project === true ||
    planned.agents.length + planned.tasks.length + planned.labels.length > 0
    ? planned
    : undefined;
}

/** Check side effects before any resource is written. A changed vector space
 * cannot be admitted merely because its new dimensions parse successfully,
 * and a changed dispatch is checked by the platform that would save it —
 * against what its declaration creates as well, while none of it exists. */
export async function checkResourceChange(
  client: PlatformConfigurationClient,
  resource: PlatformResource,
  current: ResourceObservation,
  context: ChangeContext,
) {
  if (converged(resource, current, context.secrets)) return;
  const declaredResources = context.declared ?? [];
  if (isManagedResource(resource)) {
    await checkManagedResource(
      client,
      resource,
      current.revision,
      resource.kind === 'project-dispatch'
        ? plannedForDispatch(resource.config, context)
        : undefined,
    );
    return;
  }
  if (resource.kind === 'provider-credential' && resource.config.isDefault) {
    const rows = credentials.parse(
      await client.request('/api/app/provider-credentials'),
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
  if (
    resource.kind === 'knowledge-embedding' &&
    // A change confined to the similarity floor or the serving limits
    // leaves every stored vector valid, so it needs no empty corpus.
    !sameEmbeddingModel(resource.config, current.config)
  ) {
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
  declaredResources: readonly PlatformResource[],
  secrets: DeclaredSecrets,
): Promise<void> {
  if (isManagedResource(resource)) {
    await writeManagedResource(
      client,
      resource,
      current.revision,
      declaredResources,
      secrets,
    );
    return;
  }
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
        await client.request('/api/app/provider-credentials', 'POST', {
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
  secrets: DeclaredSecrets,
): Promise<ResourceObservation> {
  const actual = await readResource(client, resource);
  if (!converged(resource, actual, secrets))
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
