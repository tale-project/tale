import { join } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { deployRelease } from '../config/releases/deploy';
import { verifyStage } from '../config/releases/stage';
import { verifyDeploymentBundle } from './bundle';
import type { ProvisionContext } from './identity';

/** Called only within the proven native organization session. The descriptor,
 * source SHA and selected automation are rechecked inside the backend before
 * any skill or workflow is imported. */
export async function provisionDeploymentConfigs(
  bundleDirectory: string,
  context: ProvisionContext,
  dependencies: { deploy?: typeof deployRelease; dataDirectory?: string } = {},
): Promise<unknown[]> {
  const bundle = await verifyDeploymentBundle(bundleDirectory);
  if (
    !bundle.spec.identity ||
    bundle.spec.identity.slug !== context.organization.slug ||
    bundle.spec.origin !== context.origin
  )
    throw preconditionError(
      'Native organization session differs from the deployment target.',
    );
  const results: unknown[] = [];
  for (const config of bundle.spec.configs) {
    const stage = verifyStage(
      join(bundleDirectory, 'configs', config.client, config.automation),
      {
        clientId: config.client,
        automationName: config.automation,
        releaseRef:
          typeof config.revision === 'string' ? config.revision : undefined,
        sourceRepository: config.repository,
        deploymentRef: bundle.deploymentRef,
      },
    );
    const cookie = context.headers().get('cookie');
    if (!cookie)
      throw preconditionError('Native provisioning session is missing.');
    const receipt =
      config.receiptPath ??
      `ops/tale-deployments/${bundle.spec.name}/${config.client}/${config.automation}.json`;
    results.push(
      await (dependencies.deploy ?? deployRelease)({
        descriptorPath: stage.descriptorPath,
        automationName: config.automation,
        manifestPath: stage.manifestPath,
        projectId: config.projectId,
        url: context.baseUrl,
        origin: context.origin,
        orgId: context.organization.id,
        cookie,
        receiptPath: join(dependencies.dataDirectory ?? '/app/data', receipt),
        deployment: bundle.deploymentRef
          ? { deploymentRef: bundle.deploymentRef }
          : undefined,
      }),
    );
  }
  return results;
}
