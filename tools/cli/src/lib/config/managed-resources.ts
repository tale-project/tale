import type { PlatformResource } from '@tale/shared/config/platform-resources';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  managedPlatformResourceSchema,
  managedAgentModelObservationSchema,
  type ManagedPlatformResource,
} from '@tale/shared/schemas/managed-configuration';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { PlatformConfigurationClient } from './platform-client';
import { valueHash } from './releases/identity';

export function isManagedResource(
  resource: PlatformResource,
): resource is ManagedPlatformResource {
  return (
    resource.kind === 'project-instructions' ||
    resource.kind === 'agent-instructions' ||
    resource.kind === 'agent-tools' ||
    resource.kind === 'agent-model' ||
    resource.kind === 'task-instructions' ||
    resource.kind === 'task-review-context' ||
    resource.kind === 'automation-definition' ||
    resource.kind === 'automation-deployment' ||
    resource.kind === 'automation-schedule' ||
    resource.kind === 'project-dispatch'
  );
}

/** The kinds a declaration may create: their native readback answers `null`
 * for a resource that does not exist yet, which planning shows as `create`.
 * Every other managed kind adopts an existing native target, so a `null`
 * readback there means a missing or retargeted identity. */
function createsWhenAbsent(resource: ManagedPlatformResource): boolean {
  return (
    resource.kind.startsWith('automation-') ||
    resource.kind === 'task-review-context' ||
    resource.kind === 'project-dispatch'
  );
}

function resourcePath(resource: ManagedPlatformResource, read = false): string {
  const { projectId } = resource.config;
  switch (resource.kind) {
    case 'project-instructions':
      return `/api/app/projects/${encodeURIComponent(projectId)}/configuration/instructions`;
    case 'project-dispatch':
      return `/api/app/tasks/dispatch/by-project/${encodeURIComponent(projectId)}/configuration`;
    case 'agent-instructions':
      return `/api/app/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(resource.config.agentId)}/configuration/instructions`;
    case 'agent-model':
      return `/api/app/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(resource.config.agentId)}/configuration/model`;
    case 'agent-tools':
      return `/api/app/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(resource.config.agentId)}/configuration/tools`;
    case 'task-instructions':
      return `/api/app/tasks/${encodeURIComponent(resource.config.taskId)}/configuration/instructions?projectId=${encodeURIComponent(projectId)}`;
    case 'task-review-context':
      return `/api/app/tasks/${encodeURIComponent(resource.config.taskId)}/configuration/review-context?projectId=${encodeURIComponent(projectId)}${read && resource.createIfMissing === true ? '&createIfMissing=true' : ''}`;
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
    if (view.hash !== null || !createsWhenAbsent(resource))
      throw preconditionError(
        'Managed configuration target is missing or inconsistent.',
      );
    return { config: null, revision: null };
  }
  const observed =
    resource.kind === 'agent-model'
      ? {
          kind: resource.kind,
          config: managedAgentModelObservationSchema.parse(view.config),
        }
      : managedPlatformResourceSchema.parse({
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

const dispatchCheckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), changed: z.boolean(), hash: z.string() }),
  z.object({
    ok: z.literal(false),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .min(1)
      .max(1_000),
  }),
]);

/** A field of the declared dispatch, such as `gates.0.labels.1`. */
const declaredPath = /^[A-Za-z]+(?:\.(?:[A-Za-z]+|\d+))*$/;

/** A dispatch is the last resource a declaration writes, and the platform
 * checks what it names (the project's agents, tasks, labels and schedules)
 * only when it saves it. Ask before anything is written, so a dispatch it
 * would refuse leaves the declaration unapplied. Only the refused fields'
 * paths are named: native text never becomes a diagnostic. */
export async function checkManagedResource(
  client: PlatformConfigurationClient,
  resource: ManagedPlatformResource,
  expectedHash: string | null,
): Promise<void> {
  if (resource.kind !== 'project-dispatch') return;
  const verdict = dispatchCheckSchema.parse(
    await client.request(`${resourcePath(resource)}/check`, 'POST', {
      config: resource.config,
      expectedHash,
    }),
  );
  if (verdict.ok) return;
  const paths = [
    ...new Set(
      verdict.issues
        .map((issue) => issue.path)
        .filter((path) => path.length <= 120 && declaredPath.test(path)),
    ),
  ];
  throw preconditionError(
    `The platform refuses the dispatch declared for project ${resource.config.projectId}${paths.length > 0 ? ` at ${paths.join(', ')}` : ''}.`,
    'Make the project have what the dispatch names (its agents, the standing roles’ open tasks, the labels of its filters and gates), or change the declaration, then plan again.',
  );
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
      ...(resource.kind === 'task-review-context' &&
      resource.createIfMissing === true
        ? { createIfMissing: true }
        : {}),
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
