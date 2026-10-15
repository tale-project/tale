import {
  PLATFORM_RESOURCES_MAX,
  resourceConvergedWithHash,
  resourceId,
  sameConfiguration,
  type PlatformConfiguration,
  type PlatformResource,
} from '@tale/shared/config/platform-resources';
import { z } from 'zod';

import { CliError, preconditionError } from '../../utils/fail';
import { readOptionalJson, writePrivateJson } from '../state/private-files';
import { DeclaredSecrets, isSecretResource } from './declared-secrets';
import { isManagedResource } from './managed-resources';
import type { PlatformConfigurationClient } from './platform-client';
import {
  configurationPlanSchema,
  parsePlatformConfiguration,
  type ConfigurationPlan,
} from './platform-model';
import {
  checkResourceChange,
  converged,
  readResource,
  verifyResource,
  writeResource,
  type ResourceObservation,
} from './platform-resources';
import { valueHash } from './releases/identity';
import { sha } from './releases/model';

const resultSchema = z.strictObject({
  id: z.string(),
  configurationSha256: sha,
  revision: z.string().max(200).nullable(),
});
const operationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  plan: configurationPlanSchema,
  verified: z.array(resultSchema).max(PLATFORM_RESOURCES_MAX),
});
const journalSchema = operationSchema.extend({
  superseded: z.array(operationSchema).max(64).optional(),
});

/** Where a run reads what a declaration takes from its environment: the
 * values of its secrets. The process's own environment unless a caller
 * names another. */
export interface EnvironmentOptions {
  environment?: Readonly<Record<string, string | undefined>>;
}

function declaredSecrets(
  client: PlatformConfigurationClient,
  options: EnvironmentOptions,
) {
  return new DeclaredSecrets(
    options.environment ?? process.env,
    client.target.organizationId,
  );
}

/** The kinds a declaration may create other resources inside of. */
const CREATORS: ReadonlySet<PlatformResource['kind']> = new Set([
  'project',
  'project-agent',
  'task',
]);

/** The resources one exists inside of, by id: its project, and its agent or
 * its task. A declaration may create them in the same run. */
function creationParents(resource: PlatformResource): string[] {
  if (
    !isManagedResource(resource) ||
    isSecretResource(resource) ||
    resource.kind === 'project'
  )
    return [];
  const { config } = resource;
  const parents = [`project/${config.projectId}`];
  if ('agentId' in config && resource.kind !== 'project-agent')
    parents.push(`project-agent/${config.projectId}/${config.agentId}`);
  if ('taskId' in config && resource.kind !== 'task')
    parents.push(`task/${config.projectId}/${config.taskId}`);
  return parents;
}

/** The hash of an absent resource's state. */
const ABSENT_SHA256 = valueHash(null);

/**
 * Read a resource unless what it exists inside of does not exist yet: a
 * project, agent or task this declaration creates (`absent`, which this
 * read adds to). Nothing inside it can exist either, so it reads as absent
 * — and its dispatch, its agents' instructions, its tasks' descriptions are
 * planned as created.
 */
async function observe(
  client: PlatformConfigurationClient,
  resource: PlatformResource,
  absent: Set<string>,
): Promise<ResourceObservation> {
  if (creationParents(resource).some((id) => absent.has(id)))
    return { config: null, revision: null };
  const current = await readResource(client, resource);
  if (CREATORS.has(resource.kind) && current.config === null)
    absent.add(resourceId(resource));
  return current;
}

/** The ids of the projects, agents and tasks a reviewed plan creates. */
function plannedCreations(
  selected: readonly PlatformResource[],
  plan: ConfigurationPlan,
): ReadonlySet<string> {
  return new Set(
    selected.flatMap((resource, index) =>
      CREATORS.has(resource.kind) && plan.resources[index]?.action === 'create'
        ? [resourceId(resource)]
        : [],
    ),
  );
}

/** A reviewed replacement may only adopt states the retained operation could
 * have produced. Unknown edits and omitted resources still require recovery. */
async function checkSupersededOperation(
  configuration: PlatformConfiguration,
  previous: z.infer<typeof journalSchema>,
  client: PlatformConfigurationClient,
  secrets: DeclaredSecrets,
) {
  const selected = ordered(configuration);
  const absent = new Set<string>();
  if (
    !sameConfiguration(
      selected.map(resourceId).sort(),
      previous.plan.resources.map(({ id }) => id).sort(),
    )
  )
    throw preconditionError(
      'A replacement plan must retain every resource of the pending operation.',
    );
  for (const resource of selected) {
    const planned = previous.plan.resources.find(
      ({ id }) => id === resourceId(resource),
    );
    if (!planned)
      throw preconditionError(
        'A replacement resource has no retained preimage.',
      );
    const verified = previous.verified.find(({ id }) => id === planned.id);
    const current = await observe(client, resource, absent);
    const currentHash = valueHash(current.config);
    if (
      !(
        (currentHash === planned.currentSha256 &&
          current.revision === planned.revision) ||
        (isSecretResource(resource)
          ? planned.desiredSha256 === valueHash(resource.config) &&
            converged(resource, current, secrets)
          : resourceConvergedWithHash(
              resource,
              current.config,
              planned.desiredSha256,
            )) ||
        (verified &&
          currentHash === verified.configurationSha256 &&
          current.revision === verified.revision)
      )
    )
      throw preconditionError(
        `Native configuration changed outside the pending operation: ${planned.id}.`,
      );
  }
}

function ordered(configuration: PlatformConfiguration) {
  const rank = (resource: PlatformResource) => {
    if (resource.kind === 'provider') return 0;
    if (resource.kind === 'provider-credential')
      return resource.config.isDefault ? 2 : 1;
    // What a resource refers to exists before it: a project before its
    // labels, the secrets and credentials an agent is equipped with before
    // the agent, the agent a standing task is assigned to before the task.
    if (resource.kind === 'project') return 3;
    if (resource.kind === 'project-label') return 4;
    if (resource.kind === 'agent-secret') return 5;
    if (resource.kind === 'connector-credential') return 6;
    if (resource.kind === 'project-agent') return 7;
    if (resource.kind === 'task') return 8;
    if (resource.kind === 'deployment') return 10;
    if (resource.kind === 'automation-definition') return 11;
    if (resource.kind === 'automation-deployment') return 12;
    if (resource.kind === 'automation-schedule') return 13;
    // A dispatch names the project's agents and tasks by id and starts work
    // as soon as it is saved switched on, so it goes last: after the
    // instructions, tools, models and review contexts its runs read, and
    // after schedules that the same declaration may be switching off.
    if (resource.kind === 'project-dispatch') return 14;
    return 9;
  };
  return [...configuration.resources].sort(
    (left, right) => rank(left) - rank(right),
  );
}

/** Read every declared resource before mutation. Unknown settings are rejected
 * by the native schemas, rather than being written as arbitrary file paths. */
export async function planPlatformConfiguration(
  input: unknown,
  client: PlatformConfigurationClient,
  options: EnvironmentOptions = {},
): Promise<ConfigurationPlan> {
  const configuration = parsePlatformConfiguration(input);
  const secrets = declaredSecrets(client, options);
  const resources: ConfigurationPlan['resources'] = [];
  const absent = new Set<string>();
  for (const resource of ordered(configuration)) {
    const current = await observe(client, resource, absent);
    await checkResourceChange(client, resource, current, {
      secrets,
      declared: configuration.resources,
      absent,
    });
    const same = converged(resource, current, secrets);
    resources.push({
      id: resourceId(resource),
      scope: resource.kind === 'deployment' ? 'instance' : 'organization',
      currentSha256: valueHash(current.config),
      desiredSha256: valueHash(resource.config),
      revision: current.revision,
      action: same
        ? 'unchanged'
        : current.config === null
          ? 'create'
          : 'update',
      effects: same
        ? []
        : resource.kind === 'deployment'
          ? ['restart-required']
          : resource.kind === 'knowledge-embedding'
            ? ['embedding-configuration']
            : [],
    });
  }
  return configurationPlanSchema.parse({
    schemaVersion: 1,
    configurationSha256: valueHash(configuration),
    target: client.target,
    resources,
  });
}

function checkPlan(
  configuration: PlatformConfiguration,
  plan: ConfigurationPlan,
  client: PlatformConfigurationClient,
) {
  if (
    plan.configurationSha256 !== valueHash(configuration) ||
    !sameConfiguration(plan.target, client.target) ||
    !sameConfiguration(
      plan.resources.map(({ id, desiredSha256 }) => ({ id, desiredSha256 })),
      ordered(configuration).map((resource) => ({
        id: resourceId(resource),
        desiredSha256: valueHash(resource.config),
      })),
    )
  )
    throw preconditionError(
      'Configuration plan differs from the selected declaration, organization or instance.',
    );
}

function assertUnchanged(
  resource: PlatformResource,
  observed: ResourceObservation,
  planned: ConfigurationPlan['resources'][number],
  secrets: DeclaredSecrets,
  creations: ReadonlySet<string>,
) {
  if (converged(resource, observed, secrets)) return;
  // Inside a project, agent or task the plan creates there was nothing to
  // review: the plan read it as absent, and what the creation left there —
  // in this run or one that stopped — is what the write replaces.
  if (
    planned.currentSha256 === ABSENT_SHA256 &&
    planned.revision === null &&
    creationParents(resource).some((id) => creations.has(id))
  )
    return;
  // An exact completed write can be adopted after its response was lost. A
  // different concurrent edit cannot be adopted just to make a retry succeed.
  if (
    valueHash(observed.config) !== planned.currentSha256 ||
    observed.revision !== planned.revision
  )
    throw preconditionError(
      `Native configuration changed since planning: ${resourceId(resource)}. Create and review a new plan.`,
    );
}

/** The caller holds its existing CLI/deployment lock. Native per-resource CAS
 * also protects against browser/admin writes from another process. There is no
 * cross-domain transaction: a pending journal records the verified subset. */
export async function applyPlatformConfiguration(
  input: unknown,
  rawPlan: unknown,
  client: PlatformConfigurationClient,
  receiptPath: string,
  options: {
    migrateOriginFrom?: string;
    supersedesPendingPlan?: string;
  } & EnvironmentOptions = {},
) {
  const configuration = parsePlatformConfiguration(input);
  const plan = configurationPlanSchema.parse(rawPlan);
  checkPlan(configuration, plan, client);
  const secrets = declaredSecrets(client, options);
  const rawPrevious = await readOptionalJson(receiptPath);
  const previous =
    rawPrevious === undefined ? undefined : journalSchema.parse(rawPrevious);
  const superseding =
    previous?.phase === 'pending' &&
    !sameConfiguration(previous.plan, plan) &&
    options.supersedesPendingPlan === valueHash(previous.plan);
  if (
    options.supersedesPendingPlan &&
    !superseding &&
    !previous?.superseded?.some(
      ({ plan: retained }) =>
        valueHash(retained) === options.supersedesPendingPlan,
    )
  )
    throw preconditionError(
      'The selected pending configuration plan is not retained in this receipt.',
    );
  if (options.migrateOriginFrom && !previous)
    throw preconditionError(
      'Origin migration requires a retained native configuration receipt.',
    );
  const migrating =
    previous?.phase === 'ready' &&
    previous.plan.target.origin === options.migrateOriginFrom &&
    sameConfiguration(
      { ...previous.plan.target, origin: client.target.origin },
      client.target,
    );
  if (
    previous &&
    ((!sameConfiguration(previous.plan.target, client.target) && !migrating) ||
      (previous.phase === 'pending' &&
        !sameConfiguration(previous.plan, plan) &&
        !superseding))
  )
    throw preconditionError(
      'A different native configuration operation is retained in this receipt. Recover its reviewed plan first.',
    );
  const selected = ordered(configuration);
  const creations = plannedCreations(selected, plan);
  if (superseding)
    await checkSupersededOperation(configuration, previous, client, secrets);
  const absent = new Set<string>();
  for (const [index, resource] of selected.entries()) {
    const current = await observe(client, resource, absent);
    assertUnchanged(
      resource,
      current,
      plan.resources[index],
      secrets,
      creations,
    );
    await checkResourceChange(client, resource, current, {
      secrets,
      declared: configuration.resources,
      absent,
    });
  }
  const journal = journalSchema.parse({
    schemaVersion: 1,
    phase: 'pending',
    plan,
    verified: [],
    ...(previous?.superseded || superseding
      ? {
          superseded: [
            ...(previous?.superseded ?? []),
            ...(superseding
              ? [
                  operationSchema.parse({
                    schemaVersion: previous.schemaVersion,
                    phase: previous.phase,
                    plan: previous.plan,
                    verified: previous.verified,
                  }),
                ]
              : []),
          ],
        }
      : {}),
  });
  await writePrivateJson(receiptPath, journal);
  let changed = false;
  for (const [index, resource] of selected.entries()) {
    try {
      const current = await readResource(client, resource);
      assertUnchanged(
        resource,
        current,
        plan.resources[index],
        secrets,
        creations,
      );
      if (!converged(resource, current, secrets)) {
        await checkResourceChange(client, resource, current, { secrets });
        await writeResource(
          client,
          resource,
          current,
          configuration.resources,
          secrets,
        );
        changed = true;
      }
      const observed = await verifyResource(client, resource, secrets);
      journal.verified.push({
        id: resourceId(resource),
        configurationSha256: valueHash(observed.config),
        revision: observed.revision,
      });
      await writePrivateJson(receiptPath, journal);
    } catch (error) {
      const cause =
        error instanceof CliError
          ? error.message
          : 'The native request or response could not be verified.';
      throw preconditionError(
        `Configuration apply stopped at ${resourceId(resource)} after ${journal.verified.length} verified resource(s). ${cause}`,
        'Read the retained pending receipt and native configuration, then retry the same reviewed plan. No automatic cross-domain rollback was attempted.',
      );
    }
  }
  // Re-read the complete set: a later write may have a native side effect on
  // an earlier resource (for example selecting another default credential).
  for (const resource of selected)
    await verifyResource(client, resource, secrets);
  journal.phase = 'ready';
  await writePrivateJson(receiptPath, journal);
  return {
    configured: true as const,
    configurationSha256: plan.configurationSha256,
    target: plan.target,
    // Public proof binds reviewed intent after native semantic readback. The
    // journal continues to retain exact observed hashes for recovery custody.
    resources: journal.verified.map((verified, index) => ({
      id: verified.id,
      revision: verified.revision,
      configurationSha256: plan.resources[index].desiredSha256,
      observedConfigurationSha256: verified.configurationSha256,
    })),
    unchanged: !changed,
    restartRequired: plan.resources.some((resource) =>
      resource.effects.includes('restart-required'),
    ),
  };
}

/** What `read` shows of a resource's native state. A declared secret's
 * digest is a verifier of its value — anyone holding it can test guesses
 * offline — so instead of it, `read` shows whether the stored value is the
 * one the environment holds now. */
function shownState(
  resource: PlatformResource,
  config: unknown,
  secrets: DeclaredSecrets,
): unknown {
  if (
    !isSecretResource(resource) ||
    typeof config !== 'object' ||
    config === null
  )
    return config;
  const valueDigest: unknown = Reflect.get(config, 'valueDigest');
  return {
    ...Object.fromEntries(
      Object.entries(config).filter(([key]) => key !== 'valueDigest'),
    ),
    valueMatches:
      typeof valueDigest === 'string' &&
      valueDigest === secrets.desired(resource).valueDigest,
  };
}

export async function readPlatformConfiguration(
  input: unknown,
  client: PlatformConfigurationClient,
  options: EnvironmentOptions = {},
) {
  const configuration = parsePlatformConfiguration(input);
  const secrets = declaredSecrets(client, options);
  const resources = [];
  const absent = new Set<string>();
  for (const resource of ordered(configuration)) {
    const actual = await observe(client, resource, absent);
    resources.push({
      id: resourceId(resource),
      scope: resource.kind === 'deployment' ? 'instance' : 'organization',
      config: shownState(resource, actual.config, secrets),
      revision: actual.revision,
      matches: converged(resource, actual, secrets),
    });
  }
  return { target: client.target, resources };
}
