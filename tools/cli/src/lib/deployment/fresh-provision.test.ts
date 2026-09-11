import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { provisionManagedBundle } from '../../commands/deploy/provision';
import { deployRelease, type DeployOptions } from '../config/releases/deploy';
import { loadClient, repoPath } from '../config/releases/identity';
import { loadRelease } from '../config/releases/manifest';
import { commandFixture } from '../config/releases/tests/command-fixture';
import { temporary } from '../config/releases/tests/fixture';
import { nativeServer } from '../config/releases/tests/native-fixture';
import { ownsGuard } from '../state/lock-guard';
import { withLock } from '../state/with-lock';
import { verifyDeploymentBundle, writeDeploymentBundle } from './bundle';
import { prepareDeploymentConfig } from './config-source';
import { provisionDeploymentConfigs } from './configs';
import { parseInstanceInput, type ProvisionContext } from './identity';
import { nativeDeploymentStateDirectory } from './provision-state';

// The public managed command refuses Windows before work: its bundle and
// backend-native state require POSIX executable modes and durable private files.
const testPosix = test.skipIf(process.platform === 'win32');

async function fixture() {
  const source = commandFixture('north-labs');
  const directory = temporary();
  const configDirectory = path.join(
    directory,
    'configs/north-labs',
    source.name,
  );
  await prepareDeploymentConfig({
    repoRoot: source.root,
    descriptorPath: repoPath(source.root, source.descriptorPath),
    automationName: source.name,
    configRef: source.options.sourceCommit,
    clientId: 'north-labs',
    catalogueRepository: source.descriptor.sourceRepository,
    output: configDirectory,
    lateOwner: true,
    deploymentRef: 'd'.repeat(40),
  });
  for (const [file, bytes] of [
    ['cli/tale', 'synthetic executable'],
    ['runtime/runtime.json', '{}'],
    ['runtime/compose.yml', 'services: {}'],
  ]) {
    const target = path.join(directory, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes, { mode: file === 'cli/tale' ? 0o755 : 0o644 });
  }
  const bundle = await writeDeploymentBundle(directory, {
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: { revision: 'c'.repeat(40), path: 'cli/tale' },
    deploymentRef: 'd'.repeat(40),
    spec: {
      schemaVersion: 1,
      name: 'north-native',
      stateDirectory: '/opt/north',
      composeProject: 'tale',
      runtime: { revision: 'c'.repeat(40), platform: 'linux/amd64' },
      origin: 'https://native.example.org',
      tlsMode: 'external',
      environment: {},
      identity: {
        email: 'operator@example.org',
        slug: 'north-labs',
        name: 'North Labs',
        ssoEnabled: false,
        bootstrap: 'fresh',
        nativeClients: [],
      },
      configs: [
        {
          repository: source.descriptor.sourceRepository,
          revision: source.options.sourceCommit,
          client: 'north-labs',
          descriptor: repoPath(source.root, source.descriptorPath),
          automation: source.name,
          project: { key: 'NORTH', name: 'North document desk' },
          skillOwner: 'operator',
        },
      ],
    },
  });
  const dataDirectory = temporary();
  const input = parseInstanceInput({
    ...bundle.spec.identity,
    origin: bundle.spec.origin,
    password: 'synthetic-password',
  });
  return { source, directory, dataDirectory, input, bundle };
}

testPosix(
  'fresh managed command freezes source and holds one native lock through identity, inference and config callbacks',
  async () => {
    const f = await fixture();
    const events: string[] = [];
    const stateDirectory = path.join(
      f.dataDirectory,
      'ops/tale-deployments/north-native',
    );
    let frozenDirectory = '';
    const dependencies = {
      dataDirectory: f.dataDirectory,
      configure: async (
        input: unknown,
        options: Parameters<typeof import('./identity').configureInstance>[1],
      ) => {
        expect(input).toEqual(f.input);
        expect(await ownsGuard(stateDirectory)).toBe(true);
        expect(options?.stateDirectory).toBe(stateDirectory);
        expect(options?.managedClients?.create).toBeFunction();
        expect(options?.managedClients?.verify).toBeFunction();
        events.push('identity');
        await options!.provision!({
          baseUrl: 'http://127.0.0.1:3005',
          origin: f.bundle.spec.origin,
          organization: { id: 'new-org', slug: 'north-labs' },
          user: { id: 'verified-new-user' },
          stateDirectory,
          headers: () => new Headers({ cookie: 'synthetic-session' }),
          request: async () => {
            throw new Error('unused');
          },
          requireJson: async () => {
            throw new Error('unused');
          },
        });
        return {
          organizationId: 'new-org',
          organizationSlug: 'north-labs',
          userId: 'verified-new-user',
          ssoEnabled: false,
          nativeClients: [],
        };
      },
      inference: async (directory: string) => {
        expect(await ownsGuard(stateDirectory)).toBe(true);
        events.push('inference');
        frozenDirectory = directory;
        expect(directory).not.toBe(f.directory);
        // Source mutation cannot alter what the following config callback sees.
        writeFileSync(
          path.join(f.directory, 'cli/tale'),
          'changed outside frozen bundle',
        );
        expect(readFileSync(path.join(directory, 'cli/tale'), 'utf8')).toBe(
          'synthetic executable',
        );
        return undefined;
      },
      configs: async (directory: string) => {
        expect(directory).toBe(frozenDirectory);
        expect(await ownsGuard(stateDirectory)).toBe(true);
        await verifyDeploymentBundle(directory);
        events.push('configs');
        return [];
      },
    };
    const result = await provisionManagedBundle(
      f.directory,
      f.input,
      {},
      dependencies,
    );
    expect(events).toEqual(['identity', 'inference', 'configs']);
    expect(result.userId).toBe('verified-new-user');
    expect(JSON.stringify(result)).not.toContain(f.input.password);
    expect(await ownsGuard(stateDirectory)).toBe(false);
    expect(existsSync(frozenDirectory)).toBe(false);
  },
);

testPosix(
  'fresh command rejects input drift before native state, and concurrent provisioning before identity',
  async () => {
    const f = await fixture();
    let identities = 0;
    const configure = async () => {
      identities++;
      throw new Error('unexpected identity');
    };
    await expect(
      provisionManagedBundle(
        f.directory,
        { ...f.input, bootstrap: undefined },
        {},
        { dataDirectory: f.dataDirectory, configure },
      ),
    ).rejects.toThrow('differs');
    expect(existsSync(path.join(f.dataDirectory, 'ops'))).toBe(false);
    const stateDirectory = nativeDeploymentStateDirectory(
      f.dataDirectory,
      f.bundle.spec.name,
    );
    await withLock(
      stateDirectory,
      'synthetic competing operation',
      async () => {
        await expect(
          provisionManagedBundle(
            f.directory,
            f.input,
            {},
            { dataDirectory: f.dataDirectory, configure },
          ),
        ).rejects.toThrow('lock');
      },
    );
    expect(identities).toBe(0);
  },
);

testPosix(
  'fresh owner compilation deploys exact native bytes into a create-once project and retains replay receipts',
  async () => {
    const f = await fixture();
    const projects: Record<string, unknown>[] = [];
    let creates = 0;
    const context: ProvisionContext = {
      baseUrl: 'http://127.0.0.1:3005',
      origin: f.bundle.spec.origin,
      organization: { id: 'new-org', slug: 'north-labs' },
      user: { id: 'verified_new_operator' },
      headers: () => new Headers({ cookie: 'synthetic-config-session' }),
      request: async (url, method = 'GET', body) => {
        expect(url).toStartWith('/api/app/projects?orgId=new-org');
        if (method === 'GET') return Response.json({ projects });
        expect(method).toBe('POST');
        creates++;
        projects.push({
          ...(body as Record<string, unknown>),
          id: 'native-created-project',
          organizationId: 'new-org',
          createdBy: 'verified_new_operator',
          archivedAt: null,
        });
        return Response.json({ projectId: 'native-created-project' });
      },
      requireJson: async (response) => response.json(),
    };
    let native: Awaited<ReturnType<typeof nativeServer>> | undefined;
    let fetchImpl: DeployOptions['fetchImpl'];
    const consumed: string[] = [];
    const dependencies = {
      dataDirectory: f.dataDirectory,
      deploy: async (options: DeployOptions) => {
        const release = loadRelease(
          options.manifestPath,
          loadClient(options.descriptorPath, options.automationName),
        );
        expect(release.manifest.skillOwnerUserId).toBe(context.user.id);
        expect(release.manifest.sourceCommit).toBe(
          f.source.options.sourceCommit,
        );
        expect(options.projectId).toBe('native-created-project');
        consumed.push(release.manifest.artifact.sha256);
        if (!native) {
          native = await nativeServer(release, options);
          fetchImpl = options.fetchImpl;
        }
        return deployRelease({ ...options, fetchImpl });
      },
    };
    // Native compilation is detached; the source checkout is no longer available.
    rmSync(f.source.root, { force: true, recursive: true });
    const first = await provisionDeploymentConfigs(
      f.directory,
      context,
      dependencies,
    );
    const second = await provisionDeploymentConfigs(
      f.directory,
      context,
      dependencies,
    );
    expect(first[0]).toMatchObject({
      projectId: 'native-created-project',
      skillOwnerUserId: context.user.id,
      releaseRef: f.source.options.sourceCommit,
      artifactSha256: consumed[0],
      automationVersion: native!.deployed,
      unchanged: false,
    });
    expect(native!.deployed).toBeGreaterThan(0);
    expect(second[0]).toMatchObject({
      ...(first[0] as object),
      unchanged: true,
    });
    expect(consumed[1]).toBe(consumed[0]);
    expect(native?.imports).toBe(1);
    expect(native?.deploys).toBe(1);
    expect(creates).toBe(1);
    expect(JSON.stringify(first)).not.toContain('synthetic-config-session');
  },
);
