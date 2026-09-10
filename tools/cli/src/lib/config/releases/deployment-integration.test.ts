import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { writeDeploymentBundle } from '../../deployment/bundle';
import { provisionDeploymentConfigs } from '../../deployment/configs';
import type { ProvisionContext } from '../../deployment/identity';
import { deployRelease, type DeployOptions } from './deploy';
import { loadClient } from './identity';
import { loadRelease } from './manifest';
import { stageRelease, verifyStage } from './stage';
import { commandFixture } from './tests/command-fixture';
import { temporary } from './tests/fixture';
import { nativeServer } from './tests/native-fixture';

const testPosix = test.skipIf(process.platform === 'win32');

// Standalone config releases are portable; a managed bundle also proves POSIX modes.
testPosix(
  'managed deployment consumes the same source stage and preserves native receipt replay',
  async () => {
    const f = commandFixture();
    const bundle = temporary();
    const stage = path.join(bundle, 'configs', 'acme', f.name);
    const deploymentRef = 'b'.repeat(40);
    const config = await stageRelease({
      repoRoot: f.root,
      descriptorPath: path.relative(f.root, f.descriptorPath),
      automationName: f.name,
      configRef: f.options.sourceCommit,
      skillOwnerUserId: f.options.skillOwnerUserId,
      deploymentRef,
      output: stage,
    });
    for (const [file, bytes] of [
      ['cli/tale', 'synthetic executable; no runtime is invoked'],
      ['runtime/runtime.json', '{}'],
      ['runtime/compose.yml', 'services: {}'],
    ]) {
      const target = path.join(bundle, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, {
        mode: file === 'cli/tale' ? 0o755 : 0o644,
      });
    }
    await writeDeploymentBundle(bundle, {
      schemaVersion: 1,
      kind: 'tale-deployment',
      deploymentRef,
      cli: { revision: 'c'.repeat(40), path: 'cli/tale' },
      spec: {
        schemaVersion: 1,
        name: 'example-instance',
        stateDirectory: '/app/example-state',
        composeProject: 'example-instance',
        runtime: { revision: 'c'.repeat(40), platform: 'linux/amd64' },
        origin: 'https://native.example',
        tlsMode: 'external',
        environment: {},
        identity: {
          email: 'operator@example.invalid',
          slug: 'org-acme',
          name: 'Example organization',
          ssoEnabled: false,
          nativeClients: [],
        },
        configs: [
          {
            repository: f.descriptor.sourceRepository,
            revision: f.options.sourceCommit,
            client: 'acme',
            descriptor: path.relative(f.root, f.descriptorPath),
            automation: f.name,
            projectId: 'bootstrap',
            skillOwner: f.options.skillOwnerUserId,
          },
        ],
      },
    });
    const paths = verifyStage(stage);
    const release = loadRelease(
      paths.manifestPath,
      loadClient(paths.descriptorPath, f.name),
    );
    const options: DeployOptions = {
      descriptorPath: paths.descriptorPath,
      manifestPath: paths.manifestPath,
      automationName: f.name,
      url: 'http://127.0.0.1:3005',
      origin: 'https://native.example',
      orgId: 'native-org-id',
      projectId: 'bootstrap',
      cookie: 'session=synthetic-managed-config',
    };
    const state = await nativeServer(release, options);
    const context: ProvisionContext = {
      baseUrl: options.url,
      origin: options.origin!,
      organization: { id: options.orgId, slug: 'org-acme' },
      user: { id: f.options.skillOwnerUserId! },
      headers: () => new Headers({ cookie: options.cookie }),
      request: async () => {
        throw new Error('unexpected bootstrap request');
      },
      requireJson: async () => {
        throw new Error('unexpected bootstrap response');
      },
    };
    const dataDirectory = temporary();
    const received: DeployOptions[] = [];
    const dependencies = {
      dataDirectory,
      deploy: async (input: DeployOptions) => {
        received.push(input);
        return deployRelease({ ...input, fetchImpl: options.fetchImpl });
      },
    };
    const first = await provisionDeploymentConfigs(
      bundle,
      context,
      dependencies,
    );
    const second = await provisionDeploymentConfigs(
      bundle,
      context,
      dependencies,
    );
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(received).toHaveLength(2);
    expect(received[0]!.deployment).toEqual({ deploymentRef });
    expect(received[0]!.orgId).toBe(options.orgId);
    expect(received[0]!.projectId).toBe('bootstrap');
    const receipt = JSON.parse(readFileSync(received[0]!.receiptPath!, 'utf8'));
    expect(receipt.schemaVersion).toBe(2);
    expect(receipt.releaseRef).toBe(f.options.sourceCommit);
    expect(receipt.artifactSha256).toBe(config.artifactSha256);
    expect(state.imports).toBe(1);
    expect(state.deploys).toBe(1);
    const before = received.length;
    await expect(
      provisionDeploymentConfigs(
        bundle,
        {
          ...context,
          organization: { ...context.organization, slug: 'other-org' },
        },
        dependencies,
      ),
    ).rejects.toThrow('differs');
    expect(received).toHaveLength(before);
    writeFileSync(paths.manifestPath, 'unexpected bundle mutation');
    await expect(
      provisionDeploymentConfigs(bundle, context, dependencies),
    ).rejects.toThrow('bundle bytes');
    expect(received).toHaveLength(before);
  },
);
