import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { preconditionError, externalDepError } from '../../utils/fail';
import {
  applyPlatformConfiguration,
  planPlatformConfiguration,
} from '../config/platform-apply';
import { configurationClient } from '../config/platform-client';
import {
  configurationPlanSchema,
  configurationTargetSchema,
  resourceId,
  type PlatformConfiguration,
} from '../config/platform-model';
import { sha256, valueHash } from '../config/releases/identity';
import { sha } from '../config/releases/model';
import { readOptionalJson } from '../state/private-files';
import { verifyDeploymentBundle } from './bundle';
import type { ProvisionContext } from './identity';
import type { RuntimeConfigurationEffect } from './runtime-configuration';

/** Deployment and standalone config apply share every resource adapter and
 * readback check. A bundle supplies reviewed intent, never a second writer. */
export async function provisionDeploymentConfiguration(
  directory: string,
  context: ProvisionContext,
) {
  const deployment = await verifyDeploymentBundle(directory);
  if (!deployment.spec.configuration) return undefined;
  if (
    !deployment.spec.identity ||
    context.organization.slug !== deployment.spec.identity.slug
  )
    throw preconditionError(
      'Native configuration belongs to another organization.',
    );
  const client = configurationClient(context);
  const receipt = join(
    context.stateDirectory ??
      join('/app/data/ops/tale-deployments', deployment.spec.name),
    'configuration.json',
  );
  const previous = z
    .object({
      phase: z.enum(['pending', 'ready']),
      plan: configurationPlanSchema,
    })
    .optional()
    .parse(await readOptionalJson(receipt));
  const plan =
    previous?.phase === 'pending'
      ? previous.plan
      : await planPlatformConfiguration(deployment.spec.configuration, client);
  const result = await applyPlatformConfiguration(
    deployment.spec.configuration,
    plan,
    client,
    receipt,
  );
  return {
    ...result,
    deploymentBundleSha256: sha256(
      await readFile(join(directory, 'deployment.json')),
    ),
  };
}

const proofSchema = z.object({
  configured: z.literal(true),
  configurationSha256: sha,
  deploymentBundleSha256: sha,
  target: configurationTargetSchema,
  resources: z
    .array(
      z.object({
        id: z.string(),
        configurationSha256: sha,
        revision: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(128),
  unchanged: z.boolean(),
  restartRequired: z.boolean(),
});

export function verifyNativeConfigurationProof(
  input: unknown,
  configuration: PlatformConfiguration,
  deploymentBundleSha256: string,
  organizationId: string,
  organizationSlug: string,
  origin: string,
) {
  const parsed = proofSchema.safeParse(input);
  const sorted = (rows: { id: string; configurationSha256: string }[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  if (
    !parsed.success ||
    parsed.data.configurationSha256 !== valueHash(configuration) ||
    parsed.data.deploymentBundleSha256 !== deploymentBundleSha256 ||
    parsed.data.target.organizationId !== organizationId ||
    parsed.data.target.organizationSlug !== organizationSlug ||
    parsed.data.target.origin !== origin ||
    valueHash(
      sorted(
        parsed.data.resources.map(({ id, configurationSha256 }) => ({
          id,
          configurationSha256,
        })),
      ),
    ) !==
      valueHash(
        sorted(
          configuration.resources.map((resource) => ({
            id: resourceId(resource),
            configurationSha256: valueHash(resource.config),
          })),
        ),
      )
  )
    throw externalDepError(
      'Native configuration receipt differs from the reviewed declaration, organization or deployment.',
    );
  return parsed.data;
}

/** A recovered native write may now be unchanged. The declaration, rather
 * than that transient response flag, carries the managed boot obligation. */
export function deploymentRuntimeConfiguration(
  configuration: PlatformConfiguration | undefined,
  proof: ReturnType<typeof verifyNativeConfigurationProof> | undefined,
): RuntimeConfigurationEffect | undefined {
  const resource = configuration?.resources.find(
    (entry) => entry.kind === 'deployment',
  );
  if (!resource) return undefined;
  if (
    !proof ||
    proof.configurationSha256 !== valueHash(configuration) ||
    !proof.resources.some(
      (entry) =>
        entry.id === 'deployment' &&
        entry.configurationSha256 === valueHash(resource.config),
    )
  )
    throw externalDepError(
      'Deployment runtime configuration has no verified native resource.',
    );
  return {
    deploymentBundleSha256: proof.deploymentBundleSha256,
    configurationSha256: proof.configurationSha256,
    target: proof.target,
    resourceSha256: valueHash(resource.config),
    config: resource.config,
  };
}
