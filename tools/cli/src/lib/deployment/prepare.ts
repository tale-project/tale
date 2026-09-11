import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { gitSha } from '../config/releases/model';
import { deploymentBuild } from './build';
import { copyDeploymentCli, writeDeploymentBundle } from './bundle';
import { prepareDeploymentConfig } from './config-source';
import { resolveDeploymentSpec, resolveValue } from './model';
import { prepareRuntime } from './runtime';
import { TALE_REPOSITORY, withDeploymentSources } from './sources';

export interface PrepareDeploymentOptions {
  spec: string;
  output: string;
  deploymentRef?: string;
  /** Optional repository@fullSHA -> local checkout map for offline preparation. */
  sourcesFile?: string;
}

export async function prepareDeployment(
  options: PrepareDeploymentOptions,
  dependencies: {
    build?: typeof deploymentBuild;
    runtime?: typeof prepareRuntime;
    config?: typeof prepareDeploymentConfig;
    sources?: typeof withDeploymentSources;
  } = {},
) {
  const build = (dependencies.build ?? deploymentBuild)();
  const spec = resolveDeploymentSpec(
    JSON.parse(await readFile(options.spec, 'utf8')),
  );
  const deploymentRef =
    options.deploymentRef !== undefined
      ? gitSha.parse(options.deploymentRef)
      : undefined;
  const runtimeRequest = {
    repository: TALE_REPOSITORY,
    revision: resolveValue(spec.runtime.revision),
  };
  const requests = [
    runtimeRequest,
    ...spec.configs.map((config) => ({
      repository: config.repository,
      revision: resolveValue(config.revision),
    })),
  ];
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  try {
    await mkdir(output, { mode: 0o755 });
  } catch {
    throw preconditionError(
      'Deployment output already exists or cannot be created. Choose a new output directory.',
    );
  }
  // A failed or interrupted prepare leaves no final manifest. Keep its owned
  // partial output available for diagnosis; apply never accepts that directory.
  await copyDeploymentCli(build.binary, output, spec.runtime.platform);
  return (dependencies.sources ?? withDeploymentSources)(
    requests,
    {
      sourcesFile: options.sourcesFile,
      sourceKey: process.env.TALE_SOURCE_SSH_KEY,
    },
    async (source) => {
      await (dependencies.runtime ?? prepareRuntime)({
        repoRoot: source(runtimeRequest),
        revision: runtimeRequest.revision,
        platform: spec.runtime.platform,
        output: join(output, 'runtime'),
      });
      for (const config of spec.configs) {
        const request = {
          repository: config.repository,
          revision: resolveValue(config.revision),
        };
        await (dependencies.config ?? prepareDeploymentConfig)({
          repoRoot: source(request),
          descriptorPath: config.descriptor,
          automationName: config.automation,
          configRef: request.revision,
          catalogueRepository: request.repository,
          clientId: config.client,
          ...(config.skillOwner === 'operator'
            ? { lateOwner: true }
            : { skillOwnerUserId: config.skillOwner }),
          deploymentRef,
          output: join(output, 'configs', config.client, config.automation),
        });
      }
      return writeDeploymentBundle(output, {
        schemaVersion: 1,
        kind: 'tale-deployment',
        deploymentRef,
        cli: { revision: build.revision, path: 'cli/tale' },
        spec,
      });
    },
  );
}
