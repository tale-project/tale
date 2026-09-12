import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyArtifactBytes } from '../config/releases/artifacts';
import { repoPath } from '../config/releases/identity';
import { fixture as clientFixture } from '../config/releases/tests/fixture';
import { verifyDeploymentBundle, writeDeploymentBundle } from './bundle';
import {
  prepareDeploymentConfig,
  verifyPreparedDeploymentConfig,
} from './config-source';
import { prepareDeployment } from './prepare';
import { TALE_REPOSITORY } from './sources';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const describePosix = describe.skipIf(process.platform === 'win32');

/** Real committed client source/compiler/capsule bytes. Runtime metadata and
 * source acquisition are explicit fakes; their separate integration owns Docker/Git transport. */
describePosix('managed preparation native-owner binding', () => {
  test.each(['operator', 'existing_owner'])(
    'prepares and verifies the exact %s source binding through the managed entry point',
    async (owner) => {
      const client = clientFixture();
      const root = await mkdtemp(join(tmpdir(), 'tale-prepare-owner-'));
      roots.push(root);
      const binary = join(root, 'tale');
      const elf = Buffer.alloc(128);
      elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
      elf.writeUInt16LE(62, 18);
      await writeFile(binary, elf);
      const spec = {
        schemaVersion: 1,
        name: 'fresh-team',
        composeProject: 'fresh',
        stateDirectory: join(root, 'state'),
        origin: 'https://native.example.invalid',
        tlsMode: 'external',
        runtime: { revision: 'a'.repeat(40) },
        identity: {
          bootstrap: 'fresh',
          email: { env: 'TALE_EMAIL' },
          password: { env: 'TALE_PASSWORD' },
          slug: 'fresh-team',
          name: 'Fresh team',
          ssoEnabled: false,
        },
        configs: [
          {
            repository: client.descriptor.sourceRepository,
            revision: client.options.sourceCommit,
            client: client.descriptor.clientId,
            descriptor: repoPath(client.root, client.descriptorPath),
            automation: client.name,
            project: { key: 'CONF', name: 'Configuration' },
            skillOwner: owner,
          },
        ],
      };
      const specPath = join(root, 'spec.json');
      await writeFile(specPath, JSON.stringify(spec));
      const output = join(root, 'prepared');
      const result = await prepareDeployment(
        { spec: specPath, output, deploymentRef: 'd'.repeat(40) },
        {
          build: () => ({ binary, revision: 'b'.repeat(40) }),
          sources: async (requests, _options, work) => {
            expect(requests).toEqual([
              { repository: TALE_REPOSITORY, revision: 'a'.repeat(40) },
              {
                repository: client.descriptor.sourceRepository,
                revision: client.options.sourceCommit,
              },
            ]);
            return work((request) =>
              request.repository === TALE_REPOSITORY ? root : client.root,
            );
          },
          runtime: async ({ output: directory }) => {
            await mkdir(directory);
            await writeFile(join(directory, 'runtime.json'), '{}');
            await writeFile(join(directory, 'compose.yml'), 'services: {}\n');
            return {
              schemaVersion: 1,
              kind: 'source-compose-0.5',
              revision: 'a'.repeat(40),
              platform: 'linux/amd64',
              source: {
                composeSha256: 'c'.repeat(64),
                caddySha256: 'c'.repeat(64),
              },
              files: {
                'compose.yml': 'c'.repeat(64),
                'Caddyfile.production': 'c'.repeat(64),
              },
              services: [],
              images: [],
            };
          },
          config: (options) =>
            prepareDeploymentConfig({
              ...options,
              validateNative: verifyArtifactBytes,
            }),
        },
      );
      expect((await verifyDeploymentBundle(output)).spec).toEqual(result.spec);
      const prepared = await verifyPreparedDeploymentConfig(
        join(output, 'configs', client.descriptor.clientId, client.name),
      );
      expect(prepared.kind).toBe(owner === 'operator' ? 'source' : 'release');
      if (prepared.kind === 'source')
        expect(JSON.stringify(prepared.receipt)).not.toContain(
          'source-validation-only',
        );
      else
        expect(
          JSON.parse(await readFile(prepared.stage.manifestPath, 'utf8'))
            .skillOwnerUserId,
        ).toBe(owner);
      // A rehashed outer manifest cannot reinterpret a capsule as an already
      // owner-bound artifact, or bind it to a different committed source.
      await rm(join(output, 'deployment.json'));
      await writeDeploymentBundle(output, {
        ...result,
        spec: {
          ...result.spec,
          configs: result.spec.configs.map((config) =>
            Object.assign({}, config, {
              skillOwner: owner === 'operator' ? 'existing_owner' : 'operator',
            }),
          ),
        },
      });
      await expect(verifyDeploymentBundle(output)).rejects.toThrow(
        'owner binding',
      );
    },
    30_000,
  );
});
