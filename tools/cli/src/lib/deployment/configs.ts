import { join } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { verifyArtifactBytes } from '../config/releases/artifacts';
import { deployRelease } from '../config/releases/deploy';
import { loadClient, sha256 } from '../config/releases/identity';
import { loadRelease } from '../config/releases/manifest';
import { validateNativeRelease } from '../config/releases/native';
import type { NativeValidator } from '../config/releases/release';
import { privateDirectory } from '../state/private-files';
import { verifyDeploymentBundle } from './bundle';
import {
  buildCapsuleStage,
  verifyPreparedDeploymentConfig,
} from './config-source';
import type { ProvisionContext } from './identity';
import { resolveValue } from './model';
import { resolveDeploymentProjects } from './projects';
import { nativeDeploymentStateDirectory } from './provision-state';

/** Called only within the proven native organization session. The descriptor,
 * source SHA and selected automation are rechecked inside the backend before
 * any skill or workflow is imported. */
export async function provisionDeploymentConfigs(
  bundleDirectory: string,
  context: ProvisionContext,
  dependencies: {
    deploy?: typeof deployRelease;
    dataDirectory?: string;
    validateNative?: NativeValidator;
  } = {},
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
  const cookie = context.headers().get('cookie');
  if (!cookie)
    throw preconditionError('Native provisioning session is missing.');
  const needsState = bundle.spec.configs.some(
    (config) => config.project || config.skillOwner === 'operator',
  );
  const stateDirectory = needsState
    ? (context.stateDirectory ??
      nativeDeploymentStateDirectory(
        dependencies.dataDirectory ?? '/app/data',
        bundle.spec.name,
      ))
    : undefined;
  const prepared = [];
  for (const config of bundle.spec.configs) {
    const directory = join(
      bundleDirectory,
      'configs',
      config.client,
      config.automation,
    );
    const expected = {
      clientId: config.client,
      automationName: config.automation,
      releaseRef: resolveValue(config.revision),
      sourceRepository: config.repository,
      deploymentRef: bundle.deploymentRef,
    };
    const captured = await verifyPreparedDeploymentConfig(directory, expected);
    if ((captured.kind === 'source') !== (config.skillOwner === 'operator'))
      throw preconditionError(
        'Native configuration owner binding differs from the prepared source.',
      );
    let stage;
    if (captured.kind === 'source') {
      if (!stateDirectory)
        throw preconditionError(
          'Late-owner configuration requires private native state.',
        );
      const output = join(
        stateDirectory,
        'compiled',
        `${captured.capsuleSha256}-${sha256(context.user.id)}`,
      );
      await privateDirectory(output, stateDirectory, process.getuid?.() ?? 0);
      stage = await buildCapsuleStage(
        directory,
        output,
        context.user.id,
        expected,
        dependencies.validateNative ?? validateNativeRelease,
      );
    } else stage = captured.stage;
    const release = loadRelease(
      stage.manifestPath,
      loadClient(stage.descriptorPath, config.automation),
    );
    await verifyArtifactBytes(release);
    if (
      release.manifest.skillOwnerUserId &&
      release.manifest.skillOwnerUserId !== context.user.id
    )
      throw preconditionError(
        'Native configuration skill owner differs from the verified operator.',
      );
    prepared.push({
      stage,
      skillOwnerUserId: release.manifest.skillOwnerUserId,
      ...(captured.kind === 'source'
        ? { sourceCapsuleSha256: captured.capsuleSha256 }
        : {}),
    });
  }
  // All source/owner checks precede native project/skill/workflow mutations.
  let projectIds: string[];
  if (bundle.spec.configs.some((config) => config.project)) {
    if (!stateDirectory)
      throw preconditionError(
        'Symbolic projects require private native state.',
      );
    projectIds = await resolveDeploymentProjects(
      context,
      bundle.spec.configs,
      bundle.spec.name,
      stateDirectory,
    );
  } else
    projectIds = bundle.spec.configs.map((config) => {
      if (!config.projectId)
        throw preconditionError('Native project target is missing.');
      return config.projectId;
    });
  const results: unknown[] = [];
  for (const [index, config] of bundle.spec.configs.entries()) {
    const { stage, skillOwnerUserId, sourceCapsuleSha256 } = prepared[index];
    const receipt =
      config.receiptPath ??
      `ops/tale-deployments/${bundle.spec.name}/${config.client}/${config.automation}.json`;
    results.push({
      ...(await (dependencies.deploy ?? deployRelease)({
        descriptorPath: stage.descriptorPath,
        automationName: config.automation,
        manifestPath: stage.manifestPath,
        projectId: projectIds[index],
        url: context.baseUrl,
        origin: context.origin,
        orgId: context.organization.id,
        cookie,
        receiptPath: join(dependencies.dataDirectory ?? '/app/data', receipt),
        deployment: bundle.deploymentRef
          ? { deploymentRef: bundle.deploymentRef }
          : undefined,
      })),
      projectId: projectIds[index],
      ...(skillOwnerUserId ? { skillOwnerUserId } : {}),
      ...(sourceCapsuleSha256 ? { sourceCapsuleSha256 } : {}),
    });
  }
  return results;
}
