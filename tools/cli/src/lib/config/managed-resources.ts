import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  managedPlatformResourceSchema,
  type ManagedPlatformResource,
} from '@tale/shared/schemas/managed-configuration';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { PlatformConfigurationClient } from './platform-client';
import type { PlatformResource } from './platform-model';
import { valueHash } from './releases/identity';

export function isManagedResource(
  resource: PlatformResource,
): resource is ManagedPlatformResource {
  return (
    resource.kind === 'project-instructions' ||
    resource.kind === 'agent-instructions' ||
    resource.kind === 'agent-tools' ||
    resource.kind === 'task-instructions' ||
    resource.kind === 'task-review-context' ||
    resource.kind === 'automation-definition' ||
    resource.kind === 'automation-deployment' ||
    resource.kind === 'automation-schedule'
  );
}

function resourcePath(resource: ManagedPlatformResource, read = false): string {
  const { projectId } = resource.config;
  switch (resource.kind) {
    case 'project-instructions':
      return `/api/app/projects/${encodeURIComponent(projectId)}/configuration/instructions`;
    case 'agent-instructions':
      return `/api/app/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(resource.config.agentId)}/configuration/instructions`;
    case 'agent-tools':
      return `/api/app/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(resource.config.agentId)}/configuration/tools`;
    case 'task-instructions':
      return `/api/app/tasks/${encodeURIComponent(resource.config.taskId)}/configuration/instructions?projectId=${encodeURIComponent(projectId)}`;
    case 'task-review-context':
      return `/api/app/tasks/${encodeURIComponent(resource.config.taskId)}/configuration/review-context?projectId=${encodeURIComponent(projectId)}`;
    default:
      return `/api/app/automations/${encodeURIComponent(resource.config.name)}/configuration${read ? `?projectId=${encodeURIComponent(projectId)}&kind=${resource.kind}` : ''}`;
  }
}

export async function readManagedResource(
  client: PlatformConfigurationClient,
  resource: ManagedPlatformResource,
) {
  const view = z
    .object({ config: z.unknown(), hash: expectedConfigurationHashSchema })
    .parse(await client.request(resourcePath(resource, true)));
  if (view.config === null) {
    if (
      view.hash !== null ||
      (!resource.kind.startsWith('automation-') &&
        resource.kind !== 'task-review-context')
    )
      throw preconditionError(
        'Managed configuration target is missing or inconsistent.',
      );
    return { config: null, revision: null };
  }
  const observed = managedPlatformResourceSchema.parse({
    kind: resource.kind,
    config: view.config,
  });
  // Stored legacy agent text may predate write-time trimming. Its preimage
  // must retain those bytes, otherwise a legitimate native hash cannot be used
  // to adopt and normalize that existing target.
  const observedConfig =
    observed.kind === 'agent-instructions'
      ? {
          ...observed.config,
          instructions: z
            .object({ instructions: z.string() })
            .parse(view.config).instructions,
        }
      : observed.config;
  if (
    observed.config.projectId !== resource.config.projectId ||
    valueHash(observedConfig) !== view.hash
  )
    throw preconditionError(
      'Managed configuration readback differs from its native identity or hash.',
    );
  if (
    'name' in resource.config &&
    (!('name' in observed.config) ||
      observed.config.name !== resource.config.name)
  )
    throw preconditionError(
      'Managed automation readback names another automation.',
    );
  if (
    'agentId' in resource.config &&
    (!('agentId' in observed.config) ||
      observed.config.agentId !== resource.config.agentId)
  )
    throw preconditionError('Managed agent readback names another agent.');
  if (
    'taskId' in resource.config &&
    (!('taskId' in observed.config) ||
      observed.config.taskId !== resource.config.taskId)
  )
    throw preconditionError('Managed task readback names another task.');
  if (
    resource.kind === 'task-review-context' &&
    (observed.kind !== 'task-review-context' ||
      observed.config.reviewerAgentId !== resource.config.reviewerAgentId)
  )
    throw preconditionError(
      'Managed review context readback names another reviewer.',
    );
  return { config: observedConfig, revision: view.hash };
}

export async function writeManagedResource(
  client: PlatformConfigurationClient,
  resource: ManagedPlatformResource,
  expectedHash: string | null,
  declared: readonly PlatformResource[],
) {
  if (!resource.kind.startsWith('automation-')) {
    await client.request(resourcePath(resource), 'POST', {
      config: resource.config,
      expectedHash,
    });
    return;
  }
  const deployment =
    resource.kind === 'automation-schedule'
      ? declared.find(
          (entry) =>
            entry.kind === 'automation-deployment' &&
            entry.config.name === resource.config.name &&
            entry.config.projectId === resource.config.projectId,
        )
      : undefined;
  if (
    resource.kind === 'automation-schedule' &&
    deployment?.kind !== 'automation-deployment'
  )
    throw preconditionError(
      'Managed schedule has no reviewed deployment prerequisite.',
    );
  await client.request(resourcePath(resource), 'POST', {
    resource,
    expectedHash,
    ...(deployment?.kind === 'automation-deployment'
      ? { definitionSha256: deployment.config.definitionSha256 }
      : {}),
  });
}
