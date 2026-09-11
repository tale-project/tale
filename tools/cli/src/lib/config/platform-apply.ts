import { z } from 'zod';

import { CliError, preconditionError } from '../../utils/fail';
import { readOptionalJson, writePrivateJson } from '../state/private-files';
import type { PlatformConfigurationClient } from './platform-client';
import {
  configurationPlanSchema,
  parsePlatformConfiguration,
  resourceId,
  sameConfiguration,
  type ConfigurationPlan,
  type PlatformConfiguration,
  type PlatformResource,
} from './platform-model';
import {
  checkResourceChange,
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
const journalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  plan: configurationPlanSchema,
  verified: z.array(resultSchema).max(128),
});

function ordered(configuration: PlatformConfiguration) {
  const rank = (resource: PlatformResource) => {
    if (resource.kind === 'provider') return 0;
    if (resource.kind === 'provider-credential')
      return resource.config.isDefault ? 2 : 1;
    if (resource.kind === 'deployment') return 4;
    return 3;
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
): Promise<ConfigurationPlan> {
  const configuration = parsePlatformConfiguration(input);
  const resources: ConfigurationPlan['resources'] = [];
  for (const resource of ordered(configuration)) {
    const current = await readResource(client, resource);
    await checkResourceChange(
      client,
      resource,
      current,
      configuration.resources,
    );
    const same = sameConfiguration(current.config, resource.config);
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
) {
  // An exact completed write can be adopted after its response was lost. A
  // different concurrent edit cannot be adopted just to make a retry succeed.
  if (
    !sameConfiguration(observed.config, resource.config) &&
    (valueHash(observed.config) !== planned.currentSha256 ||
      observed.revision !== planned.revision)
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
) {
  const configuration = parsePlatformConfiguration(input);
  const plan = configurationPlanSchema.parse(rawPlan);
  checkPlan(configuration, plan, client);
  const rawPrevious = await readOptionalJson(receiptPath);
  const previous =
    rawPrevious === undefined ? undefined : journalSchema.parse(rawPrevious);
  if (
    previous &&
    (!sameConfiguration(previous.plan.target, client.target) ||
      (previous.phase === 'pending' && !sameConfiguration(previous.plan, plan)))
  )
    throw preconditionError(
      'A different native configuration operation is retained in this receipt. Recover its reviewed plan first.',
    );
  const selected = ordered(configuration);
  for (const [index, resource] of selected.entries()) {
    const current = await readResource(client, resource);
    assertUnchanged(resource, current, plan.resources[index]);
    await checkResourceChange(
      client,
      resource,
      current,
      configuration.resources,
    );
  }
  const journal = journalSchema.parse({
    schemaVersion: 1,
    phase: 'pending',
    plan,
    verified: [],
  });
  await writePrivateJson(receiptPath, journal);
  let changed = false;
  for (const [index, resource] of selected.entries()) {
    try {
      const current = await readResource(client, resource);
      assertUnchanged(resource, current, plan.resources[index]);
      if (!sameConfiguration(current.config, resource.config)) {
        await checkResourceChange(client, resource, current);
        await writeResource(client, resource, current);
        changed = true;
      }
      const observed = await verifyResource(client, resource);
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
  for (const resource of selected) await verifyResource(client, resource);
  journal.phase = 'ready';
  await writePrivateJson(receiptPath, journal);
  return {
    configured: true as const,
    configurationSha256: plan.configurationSha256,
    target: plan.target,
    resources: journal.verified,
    unchanged: !changed,
    restartRequired: plan.resources.some((resource) =>
      resource.effects.includes('restart-required'),
    ),
  };
}

export async function readPlatformConfiguration(
  input: unknown,
  client: PlatformConfigurationClient,
) {
  const configuration = parsePlatformConfiguration(input);
  const resources = [];
  for (const resource of ordered(configuration)) {
    const actual = await readResource(client, resource);
    resources.push({
      id: resourceId(resource),
      scope: resource.kind === 'deployment' ? 'instance' : 'organization',
      config: actual.config,
      revision: actual.revision,
      matches: sameConfiguration(actual.config, resource.config),
    });
  }
  return { target: client.target, resources };
}
