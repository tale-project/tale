import type { PlatformResource } from '@tale/shared/config/platform-resources';
import { expectedConfigurationHashSchema } from '@tale/shared/schemas/configuration';
import {
  managedPlatformResourceSchema,
  managedAgentModelObservationSchema,
  managedProjectDispatchObservationSchema,
  managedObservationSchemas,
  type ManagedDispatchPlan,
  type ManagedPlatformResource,
} from '@tale/shared/schemas/managed-configuration';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { DeclaredSecrets } from './declared-secrets';
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
    resource.kind === 'project-dispatch' ||
    resource.kind === 'project' ||
    resource.kind === 'project-label' ||
    resource.kind === 'project-agent' ||
    resource.kind === 'task' ||
    resource.kind === 'agent-secret' ||
    resource.kind === 'connector-credential'
  );
}

/** The kinds a declaration names by an identity it may create
 * (`createIfMissing`), whose readback answers `null` for one that does not
 * exist yet. */
type CreatableResource = Extract<
  ManagedPlatformResource,
  {
    kind:
      | 'project'
      | 'project-label'
      | 'project-agent'
      | 'task'
      | 'agent-secret'
      | 'connector-credential';
  }
>;

function isCreatableResource(
  resource: ManagedPlatformResource,
): resource is CreatableResource {
  return resource.kind in managedObservationSchemas;
}

/** The kinds a declaration may create: their native readback answers `null`
 * for a resource that does not exist yet, which planning shows as `create`.
 * Every other managed kind adopts an existing native target, so a `null`
 * readback there means a missing or retargeted identity. A kind that names
 * its identity explicitly creates only when its declaration says so
 * (`createIfMissing`). */
function createsWhenAbsent(resource: ManagedPlatformResource): boolean {
  if (isCreatableResource(resource)) return resource.createIfMissing === true;
  return (
    resource.kind.startsWith('automation-') ||
    resource.kind === 'task-review-context' ||
    resource.kind === 'project-dispatch'
  );
}

const encode = encodeURIComponent;

function resourcePath(resource: ManagedPlatformResource, read = false): string {
  // A read of a resource the declaration may create says so: the platform
  // then answers `null` for an identity nothing holds instead of not found.
  const creating =
    read && 'createIfMissing' in resource && resource.createIfMissing === true;
  const opt = (separator: '?' | '&') =>
    creating ? `${separator}createIfMissing=true` : '';
  switch (resource.kind) {
    case 'agent-secret':
      return `/api/app/agent-secrets/configuration?name=${encode(resource.config.name)}${opt('&')}`;
    case 'connector-credential':
      return `/api/app/connector-credentials/configuration?connector=${encode(resource.config.connector)}&name=${encode(resource.config.name)}${opt('&')}`;
    default:
      break;
  }
  const projectId = encode(resource.config.projectId);
  switch (resource.kind) {
    case 'project':
      return `/api/app/projects/${projectId}/configuration/project${opt('?')}`;
    case 'project-label':
      return `/api/app/tasks/labels/by-project/${projectId}/configuration?name=${encode(resource.config.name)}${opt('&')}`;
    case 'project-agent':
      return `/api/app/projects/${projectId}/agents/${encode(resource.config.agentId)}/configuration/agent${opt('?')}`;
    case 'task':
      return `/api/app/tasks/${encode(resource.config.taskId)}/configuration/task?projectId=${projectId}${opt('&')}`;
    case 'project-instructions':
      return `/api/app/projects/${projectId}/configuration/instructions`;
    case 'project-dispatch':
      return `/api/app/tasks/dispatch/by-project/${projectId}/configuration`;
    case 'agent-instructions':
      return `/api/app/projects/${projectId}/agents/${encode(resource.config.agentId)}/configuration/instructions`;
    case 'agent-model':
      return `/api/app/projects/${projectId}/agents/${encode(resource.config.agentId)}/configuration/model`;
    case 'agent-tools':
      return `/api/app/projects/${projectId}/agents/${encode(resource.config.agentId)}/configuration/tools`;
    case 'task-instructions':
      return `/api/app/tasks/${encode(resource.config.taskId)}/configuration/instructions?projectId=${projectId}`;
    case 'task-review-context':
      return `/api/app/tasks/${encode(resource.config.taskId)}/configuration/review-context?projectId=${projectId}${read && resource.createIfMissing === true ? '&createIfMissing=true' : ''}`;
    default:
      return `/api/app/automations/${encode(resource.config.name)}/configuration${read ? `?projectId=${projectId}&kind=${resource.kind}` : ''}`;
  }
}

/** A creatable resource's readback, held to the identity it was read by:
 * the same project, agent, task, label, secret or credential — a label and
 * a credential whatever their name's case, as the platform matches them. */
function observeCreatable(
  resource: CreatableResource,
  config: unknown,
): Record<string, unknown> {
  const observed: Record<string, unknown> =
    managedObservationSchemas[resource.kind].parse(config);
  const declared: Record<string, unknown> = resource.config;
  const sameName = (left: unknown, right: unknown, folded: boolean) =>
    typeof left === 'string' &&
    typeof right === 'string' &&
    (folded ? left.toLowerCase() === right.toLowerCase() : left === right);
  const identity: Record<CreatableResource['kind'], readonly string[]> = {
    project: ['projectId'],
    'project-label': ['projectId'],
    'project-agent': ['projectId', 'agentId'],
    task: ['projectId', 'taskId'],
    'agent-secret': ['name'],
    'connector-credential': ['connector'],
  };
  const folded =
    resource.kind === 'project-label' ||
    resource.kind === 'connector-credential';
  if (
    identity[resource.kind].some(
      (key) => !sameName(observed[key], declared[key], false),
    ) ||
    (folded && !sameName(observed.name, declared.name, true))
  )
    throw preconditionError(
      'Managed configuration readback names another resource.',
    );
  return observed;
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
  if (isCreatableResource(resource)) {
    const config = observeCreatable(resource, view.config);
    if (valueHash(config) !== view.hash)
      throw preconditionError(
        'Managed configuration readback differs from its native identity or hash.',
      );
    return { config, revision: view.hash };
  }
  const observed =
    resource.kind === 'agent-model'
      ? {
          kind: resource.kind,
          config: managedAgentModelObservationSchema.parse(view.config),
        }
      : resource.kind === 'project-dispatch'
        ? // A dispatch stored before a write's later rules still reads, so
          // the plan can correct it instead of failing to read it.
          {
            kind: resource.kind,
            config: managedProjectDispatchObservationSchema.parse(view.config),
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
    !('projectId' in observed.config) ||
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
  /** What the same declaration creates in the dispatch's project, which the
   * check counts as the project's: a dispatch may name agents, tasks and
   * labels — and a project — that exist only once the declaration is
   * applied. The save that writes it checks again what then exists. */
  planned?: ManagedDispatchPlan,
): Promise<void> {
  if (resource.kind !== 'project-dispatch') return;
  const verdict = dispatchCheckSchema.parse(
    await client.request(`${resourcePath(resource)}/check`, 'POST', {
      config: resource.config,
      expectedHash,
      ...(planned !== undefined ? { planned } : {}),
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

/** What a created resource starts with that other kinds of the same
 * declaration own: an agent's runtime, model, instructions and tools, a
 * task's description. It is created whole, so it never runs a moment on
 * anything else, and those kinds read back as declared at once. */
function creationSeed(
  resource: CreatableResource,
  declared: readonly PlatformResource[],
): Record<string, unknown> {
  if (resource.kind === 'project-agent') {
    const { projectId, agentId } = resource.config;
    const owned = <K extends PlatformResource['kind']>(kind: K) =>
      declared.find(
        (entry): entry is Extract<PlatformResource, { kind: K }> =>
          entry.kind === kind &&
          'agentId' in entry.config &&
          entry.config.projectId === projectId &&
          entry.config.agentId === agentId,
      );
    const model = owned('agent-model');
    if (!model)
      throw preconditionError(
        'A created project agent requires its declared agent-model.',
      );
    const instructions = owned('agent-instructions');
    const tools = owned('agent-tools');
    return {
      seed: {
        harness: model.config.harness,
        model: model.config.model,
        modelProvider: model.config.modelProvider,
        ...(instructions
          ? { instructions: instructions.config.instructions }
          : {}),
        ...(tools ? { tools: tools.config.tools } : {}),
      },
    };
  }
  if (resource.kind === 'task') {
    const { projectId, taskId } = resource.config;
    const instructions = declared.find(
      (entry) =>
        entry.kind === 'task-instructions' &&
        entry.config.projectId === projectId &&
        entry.config.taskId === taskId,
    );
    return instructions?.kind === 'task-instructions'
      ? { description: instructions.config.description }
      : {};
  }
  return {};
}

/** Write a resource a declaration may create. A secret's values travel in
 * this one request body alone. */
async function writeCreatableResource(
  client: PlatformConfigurationClient,
  resource: CreatableResource,
  expectedHash: string | null,
  declared: readonly PlatformResource[],
  secrets: DeclaredSecrets,
) {
  const creation = {
    expectedHash,
    ...(resource.createIfMissing === true ? { createIfMissing: true } : {}),
  };
  const path = resourcePath(resource);
  if (resource.kind === 'agent-secret') {
    await client.request(path, 'POST', {
      name: resource.config.name,
      value: secrets.agentSecretValue(resource),
      ...creation,
    });
    return;
  }
  if (resource.kind === 'connector-credential') {
    const { fields: _sources, ...config } = resource.config;
    await client.request(path, 'POST', {
      config,
      secret: secrets.connectorCredentialValues(resource),
      ...creation,
    });
    return;
  }
  await client.request(path, 'POST', {
    config: resource.config,
    ...creation,
    ...(resource.kind === 'project' && resource.key !== undefined
      ? { key: resource.key }
      : {}),
    ...(resource.kind === 'task' && resource.initialStatus !== undefined
      ? { initialStatus: resource.initialStatus }
      : {}),
    ...(expectedHash === null ? creationSeed(resource, declared) : {}),
  });
}

export async function writeManagedResource(
  client: PlatformConfigurationClient,
  resource: ManagedPlatformResource,
  expectedHash: string | null,
  declared: readonly PlatformResource[],
  secrets: DeclaredSecrets,
) {
  if (isCreatableResource(resource)) {
    await writeCreatableResource(
      client,
      resource,
      expectedHash,
      declared,
      secrets,
    );
    return;
  }
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
