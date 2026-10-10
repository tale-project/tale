import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256, stableJson, valueHash } from '../config/releases/identity';
import type { exec } from '../docker/exec';
import { acquireLock } from '../state/acquire-lock';
import { releaseLock } from '../state/release-lock';
import { acceptDeployment } from './acceptance';
import { writeDeploymentBundle } from './bundle';
import { deploymentSpecSchema } from './model';
import { applyRuntime } from './runtime-apply';
import { prepareRuntime } from './runtime-prepare';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// Managed runtime operations are POSIX-only, matching the apply fixture.
setDefaultTimeout(30_000);
const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0))
    rmSync(f.directory, { recursive: true, force: true });
});
async function fixture() {
  const f = runtimeFixture();
  fixtures.push(f);
  const docker = new RuntimeDockerFixture(f);
  const bundle = join(f.directory, 'deployment');
  mkdirSync(join(bundle, 'cli'), { recursive: true });
  writeFileSync(join(bundle, 'cli/tale'), 'frozen fixture', { mode: 0o755 });
  writeFileSync(join(bundle, 'cli/tale.mjs'), '// fixture');
  f.options.bundleDirectory = join(bundle, 'runtime');
  await prepareRuntime(
    {
      repoRoot: f.repoRoot,
      revision: f.revision,
      output: f.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  await applyRuntime(f.options, docker.dependencies());
  const spec = deploymentSpecSchema.parse({
    schemaVersion: 1,
    name: f.options.name,
    stateDirectory: f.options.stateDirectory,
    composeProject: f.options.composeProject,
    origin: f.options.origin,
    tlsMode: 'external',
    runtime: { revision: f.revision },
  });
  const writeBundle = () =>
    writeDeploymentBundle(bundle, {
      schemaVersion: 1,
      kind: 'tale-deployment',
      cli: { revision: 'a'.repeat(40), path: 'cli/tale' },
      deploymentRef: 'c'.repeat(40),
      spec,
    });
  await writeBundle();
  const runtime = JSON.parse(
    readFileSync(join(f.options.bundleDirectory, 'runtime.json'), 'utf8'),
  );
  const proof = {
    schemaVersion: 1,
    phase: 'ready',
    name: spec.name,
    revision: f.revision,
    cliRevision: 'a'.repeat(40),
    deploymentRef: 'c'.repeat(40),
    bundleSha256: sha256(readFileSync(join(bundle, 'deployment.json'))),
    images: runtime.images,
  };
  const ready = join(f.options.stateDirectory, '.tale/deployment-ready.json');
  const writeReady = () =>
    writeFileSync(ready, JSON.stringify(proof), { mode: 0o600 });
  writeReady();
  for (const [reference, image] of docker.imageMetadata) {
    image.Id = `sha256:${sha256(reference.split('@')[0]!)}`;
    (image.Config as { Labels: Record<string, string> }).Labels[
      'org.opencontainers.image.version'
    ] = '1.2.3';
  }
  for (const container of docker.containers) {
    container.Image = docker.imageMetadata.get(
      (container.Config as { Image: string }).Image,
    )!.Id;
    container.RestartCount = 0;
  }
  const sql = {
    db: '["0001_initial.sql","0002_data.ts"]',
    'knowledge-db': '["1"]\n["2"]',
  };
  const instances = {
    platform: '11111111-1111-4111-8111-111111111111',
    'backend-api': '22222222-2222-4222-8222-222222222222',
  };
  let hook: (args: string[]) => void = () => {};
  const run: typeof exec = async (command, args, options) => {
    hook(args);
    if (args[0] === 'exec' && args.includes('bun')) {
      const container = docker.containers.find(
        (c) => c.Id === args[args.indexOf('bun') - 1],
      )!;
      const service = (container.Config as { Labels: Record<string, string> })
        .Labels['com.docker.compose.service'] as keyof typeof instances;
      expect(args.at(-1)).toContain("credentials:'omit'");
      return {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          status: 200,
          identity: `v1;service=${service};instance=${instances[service]}`,
        }),
        stderr: '',
      };
    }
    if (args[0] === 'exec' && args[1] === '-i') {
      const container = docker.containers.find((c) => c.Id === args[2])!;
      const service = (container.Config as { Labels: Record<string, string> })
        .Labels['com.docker.compose.service'] as keyof typeof sql;
      expect(options?.stdin).toContain('BEGIN READ ONLY;');
      expect(options?.maxOutputBytes).toBe(1_048_576);
      return { success: true, exitCode: 0, stdout: sql[service], stderr: '' };
    }
    return docker.execute(command, args, options);
  };
  let fetched = 0;
  const request = (async (url: string | URL | Request) => {
    fetched++;
    const service =
      url === `${spec.origin}/api/health` ? 'platform' : 'backend-api';
    expect(url).toBe(
      `${spec.origin}${service === 'platform' ? '/api/health' : '/api/health/ready'}`,
    );
    return Response.json(
      service === 'platform'
        ? { status: 'ok', version: '1.2.3' }
        : { ok: true, service: 'backend' },
      {
        headers: {
          'Tale-Serving-Identity': `v1;service=${service};instance=${instances[service]}`,
        },
      },
    );
  }) as typeof fetch;
  docker.calls = [];
  return {
    f,
    docker,
    bundle,
    runtime,
    proof,
    ready,
    writeReady,
    writeBundle,
    sql,
    instances,
    options: {
      bundle,
      cliRef: 'a'.repeat(40),
      deploymentRef: 'c'.repeat(40),
      expectedVersion: '1.2.3',
    },
    dependencies: { exec: run, fetch: request },
    setHook: (next: typeof hook) => {
      hook = next;
    },
    fetched: () => fetched,
  };
}
describe.skipIf(process.platform === 'win32')(
  'managed deployment acceptance',
  () => {
    test('accepts exact current source ledgers, OCI version and serving; does not mistake sourceTag for version', async () => {
      const f = await fixture();
      const result = await acceptDeployment(f.options, f.dependencies);
      expect(result.version).toBe('1.2.3');
      expect(result.images.every((i) => i.sourceTag !== '1.2.3')).toBe(true);
      expect(result.migrations).toEqual(
        f.runtime.migrations.map((ledger: unknown) => ({
          ...(ledger as object),
          inventorySha256: valueHash(ledger),
        })),
      );
      expect(result.readyReceiptSha256).toBe(sha256(readFileSync(f.ready)));
      expect(f.fetched()).toBe(4);
      expect(result.serving.originRoute).toBeUndefined();
      expect(result.serving.frontend.instance).toBe(f.instances.platform);
      expect(result.serving.backend.instance).toBe(f.instances['backend-api']);
      expect(
        f.docker.calls.every((c) =>
          ['info', 'network', 'ps', 'container', 'image'].includes(c.args[0]!),
        ),
      ).toBe(true);
    }, 30_000);
    test('binds a private gateway full identity and its only network through final acceptance', async () => {
      const f = await fixture();
      const id = 'f'.repeat(64);
      const gateway = {
        Id: id,
        Image: `sha256:${'e'.repeat(64)}`,
        RestartCount: 0,
        State: { Running: true, StartedAt: '2026-10-01T00:00:00Z' },
        NetworkSettings: {
          Networks: {
            private: { NetworkID: 'd'.repeat(64), IPAddress: '172.20.0.2' },
          },
        },
      };
      let observations = 0;
      const result = await acceptDeployment(
        { ...f.options, originContainer: id },
        {
          ...f.dependencies,
          exec: async (command, args, options) => {
            if (args.join(' ') === `container inspect ${id}`) {
              observations++;
              return {
                success: true,
                exitCode: 0,
                stdout: JSON.stringify([gateway]),
                stderr: '',
              };
            }
            return f.dependencies.exec(command, args, options);
          },
        },
      );
      expect(result.serving.origin).toBe(f.f.options.origin);
      expect(result.serving.originRoute).toEqual({
        kind: 'container',
        containerId: id,
        networkId: 'd'.repeat(64),
        address: '172.20.0.2',
      });
      expect(observations).toBe(6);
      expect(f.fetched()).toBe(4);
    });
    for (const mode of [
      'wrong-id',
      'stopped',
      'missing',
      'multi-address',
      'invalid-address',
      'changed-image',
      'changed-start',
      'changed-network',
      'changed-address',
      'restarted',
      'changed-final',
    ])
      test(`refuses private origin ${mode} without accepting stale gateway proof`, async () => {
        const f = await fixture();
        const id = 'f'.repeat(64);
        let observations = 0;
        await expect(
          acceptDeployment(
            { ...f.options, originContainer: id },
            {
              ...f.dependencies,
              exec: async (command, args, options) => {
                if (args.join(' ') === `container inspect ${id}`) {
                  observations++;
                  const changed =
                    mode === 'changed-final'
                      ? observations === 6
                      : observations > 1;
                  const gateway = {
                    Id: mode === 'wrong-id' ? 'a'.repeat(64) : id,
                    Image: `sha256:${(changed && (mode === 'changed-image' || mode === 'changed-final') ? 'a' : 'e').repeat(64)}`,
                    RestartCount: changed && mode === 'restarted' ? 1 : 0,
                    State: {
                      Running: mode !== 'stopped',
                      StartedAt:
                        changed && mode === 'changed-start'
                          ? '2026-10-02T00:00:00Z'
                          : '2026-10-01T00:00:00Z',
                    },
                    NetworkSettings: {
                      Networks: {
                        private: {
                          NetworkID: (changed && mode === 'changed-network'
                            ? 'a'
                            : 'd'
                          ).repeat(64),
                          IPAddress:
                            mode === 'invalid-address'
                              ? ''
                              : changed && mode === 'changed-address'
                                ? '172.20.0.3'
                                : '172.20.0.2',
                        },
                        ...(mode === 'multi-address'
                          ? {
                              other: {
                                NetworkID: 'b'.repeat(64),
                                IPAddress: '172.21.0.2',
                              },
                            }
                          : {}),
                      },
                    },
                  };
                  return {
                    success: true,
                    exitCode: 0,
                    stdout: JSON.stringify(mode === 'missing' ? [] : [gateway]),
                    stderr: '',
                  };
                }
                return f.dependencies.exec(command, args, options);
              },
            },
          ),
        ).rejects.toThrow();
        expect(f.fetched()).toBe(mode === 'changed-final' ? 4 : 0);
      });
    test('refuses short private-origin names before Docker or health calls', async () => {
      const f = await fixture();
      await expect(
        acceptDeployment(
          { ...f.options, originContainer: 'gateway' },
          f.dependencies,
        ),
      ).rejects.toThrow();
      expect(f.docker.calls).toEqual([]);
      expect(f.fetched()).toBe(0);
    });
    test('accepts a third-party registry image when Docker omits Labels', async () => {
      const f = await fixture();
      const registry = [...f.docker.imageMetadata].find(([reference]) =>
        reference.startsWith('registry@'),
      )![1];
      registry.Config = {};
      const result = await acceptDeployment(f.options, f.dependencies);
      expect(result.version).toBe('1.2.3');
      expect(result.readyReceiptSha256).toBe(sha256(readFileSync(f.ready)));
      expect(f.fetched()).toBe(4);
    });
    for (const labels of [null, {}, { 'external.annotation': 'value' }])
      test(`accepts supported third-party Docker labels ${JSON.stringify(labels)}`, async () => {
        const f = await fixture();
        const registry = [...f.docker.imageMetadata].find(([reference]) =>
          reference.startsWith('registry@'),
        )![1];
        registry.Config = { Labels: labels };
        expect(
          (await acceptDeployment(f.options, f.dependencies)).version,
        ).toBe('1.2.3');
      });
    for (const config of [
      undefined,
      null,
      { Labels: [] },
      { Labels: 1 },
      { Labels: { invalid: false } },
    ])
      test(`refuses malformed Docker image Config ${JSON.stringify(config)}`, async () => {
        const f = await fixture();
        const registry = [...f.docker.imageMetadata].find(([reference]) =>
          reference.startsWith('registry@'),
        )![1];
        registry.Config = config;
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow();
        expect(f.fetched()).toBe(0);
      });
    for (const labels of [
      undefined,
      null,
      {},
      { 'org.opencontainers.image.version': '1.2.3' },
      {
        'org.opencontainers.image.revision': 'wrong-source',
        'org.opencontainers.image.version': '1.2.3',
      },
    ])
      test(`refuses Tale images without the required source label ${JSON.stringify(labels)}`, async () => {
        const f = await fixture();
        const [reference, tale] = [...f.docker.imageMetadata].find(
          ([candidate]) =>
            candidate.startsWith('ghcr.io/tale-project/tale/') &&
            candidate.includes('@'),
        )!;
        tale.Config = labels === undefined ? {} : { Labels: labels };
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow('complete source revision');
        expect(
          f.docker.calls.some(
            (call) =>
              call.args[0] === 'image' &&
              call.args[1] === 'inspect' &&
              call.args[2] === reference,
          ),
        ).toBe(true);
        expect(f.fetched()).toBe(0);
      });
    test('refuses a Tale image with the right source but no version label', async () => {
      const f = await fixture();
      const tale = [...f.docker.imageMetadata].find(
        ([reference]) =>
          reference.startsWith('ghcr.io/tale-project/tale/') &&
          reference.includes('@'),
      )![1];
      tale.Config = {
        Labels: { 'org.opencontainers.image.revision': f.f.revision },
      };
      await expect(acceptDeployment(f.options, f.dependencies)).rejects.toThrow(
        'release version and source',
      );
      expect(f.fetched()).toBe(0);
    });
    for (const timestamp of [
      '2026-09-10T00:00:00Z',
      '2026-09-10T00:00:00.123456789Z',
      '2026-09-10T00:00:00.123456789+00:00',
      '2026-09-10T02:00:00+02:00',
      '2026-09-09T22:00:00-02:00',
    ])
      test(`accepts Docker RFC3339Nano timestamp ${timestamp}`, async () => {
        const f = await fixture();
        for (const container of f.docker.containers)
          (container.State as { StartedAt: string }).StartedAt = timestamp;
        expect(
          (await acceptDeployment(f.options, f.dependencies)).version,
        ).toBe('1.2.3');
      });
    for (const timestamp of [
      '2026-02-30T00:00:00Z',
      '2026-09-10T00:00Z',
      '2026-09-10T00:00:00.1234567890Z',
      '2026-09-10T00:00:00+25:00',
      '2026-09-10T00:00:00+0200',
      '2026-09-10T00:00:00',
    ])
      test(`refuses invalid Docker RFC3339Nano timestamp ${timestamp}`, async () => {
        const f = await fixture();
        (f.docker.containers[0]!.State as { StartedAt: string }).StartedAt =
          timestamp;
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow();
        expect(f.fetched()).toBe(0);
      });
    for (const [field, value] of [
      ['cliRef', 'b'.repeat(40)],
      ['deploymentRef', 'b'.repeat(40)],
      ['expectedVersion', 'v1.2.3'],
    ] as const)
      test(`refuses invalid ${field} before observations`, async () => {
        const f = await fixture();
        await expect(
          acceptDeployment({ ...f.options, [field]: value }, f.dependencies),
        ).rejects.toThrow();
        expect(f.docker.calls).toHaveLength(0);
      });
    test('legacy bundles remain verifiable but acceptance refuses their absent inventory', async () => {
      const f = await fixture();
      delete f.runtime.migrations;
      writeFileSync(
        join(f.f.options.bundleDirectory, 'runtime.json'),
        JSON.stringify(f.runtime),
      );
      rmSync(join(f.bundle, 'deployment.json'));
      await f.writeBundle();
      f.proof.bundleSha256 = sha256(
        readFileSync(join(f.bundle, 'deployment.json')),
      );
      f.writeReady();
      await expect(acceptDeployment(f.options, f.dependencies)).rejects.toThrow(
        'source-derived migration inventory',
      );
      expect(f.docker.calls).toHaveLength(0);
    });
    test('refuses pending deployment and respects the native lock', async () => {
      const f = await fixture();
      const pending = join(
        f.f.options.stateDirectory,
        '.tale/deployment-pending.json',
      );
      writeFileSync(pending, '{}');
      await expect(acceptDeployment(f.options, f.dependencies)).rejects.toThrow(
        'unfinished',
      );
      rmSync(pending);
      await acquireLock(f.f.options.stateDirectory, 'test');
      try {
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow('lock');
      } finally {
        await releaseLock(f.f.options.stateDirectory);
      }
      expect(f.docker.calls).toHaveLength(0);
    });
    for (const actual of [
      '["0001_initial.sql"]',
      '["0001_initial.sql","0002_data.ts","0003_unknown.sql"]',
      '["0002_data.ts","0001_initial.sql"]',
    ])
      test(`refuses app ledger difference ${actual}`, async () => {
        const f = await fixture();
        f.sql.db = actual;
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow('migration ledgers');
      });
    test('refuses a wrong OCI version even when health would echo the expectation', async () => {
      const f = await fixture();
      for (const image of f.docker.imageMetadata.values())
        (image.Config as { Labels: Record<string, string> }).Labels[
          'org.opencontainers.image.version'
        ] = '1.2.2';
      await expect(acceptDeployment(f.options, f.dependencies)).rejects.toThrow(
        'release version',
      );
      expect(f.fetched()).toBe(0);
    });
    test('refuses running image mismatch', async () => {
      const f = await fixture();
      f.docker.containers[0]!.Image = `sha256:${'9'.repeat(64)}`;
      await expect(acceptDeployment(f.options, f.dependencies)).rejects.toThrow(
        'pinned image identity',
      );
    });
    for (const mutation of [
      'restart',
      'startedAt',
      'ready',
      'ledger',
      'topology',
    ] as const)
      test(`refuses ${mutation} changes during observation`, async () => {
        const f = await fixture();
        let queries = 0;
        f.setHook((args) => {
          if (args[0] === 'exec' && ++queries === 3) {
            if (mutation === 'restart')
              f.docker.containers[0]!.RestartCount = 1;
            if (mutation === 'startedAt')
              (
                f.docker.containers[0]!.State as { StartedAt: string }
              ).StartedAt = '2026-09-10T00:00:01+00:00';
            if (mutation === 'ready')
              writeFileSync(
                f.ready,
                stableJson({ ...f.proof, extra: 'changed' }),
              );
            if (mutation === 'ledger') f.sql.db = '["0001_initial.sql"]';
            if (mutation === 'topology') f.docker.containers.pop();
          }
        });
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow();
      });
    test('external observation budget refuses after a slow observation', async () => {
      const f = await fixture();
      let now = 0;
      f.setHook(() => {
        now = 120_001;
      });
      await expect(
        acceptDeployment(f.options, { ...f.dependencies, now: () => now }),
      ).rejects.toThrow('managed runtime operation');
      expect(f.docker.calls).toHaveLength(1);
    });
    for (const service of ['platform', 'backend-api'] as const) {
      test(`refuses a late canonical ${service} route substitution`, async () => {
        const f = await fixture();
        const request = (async (input, init) => {
          const response = await f.dependencies.fetch(input, init);
          if (
            f.fetched() > 2 &&
            response.headers
              .get('Tale-Serving-Identity')
              ?.includes(`service=${service};`)
          )
            response.headers.set(
              'Tale-Serving-Identity',
              `v1;service=${service};instance=33333333-3333-4333-8333-333333333333`,
            );
          return response;
        }) as typeof fetch;
        await expect(
          acceptDeployment(f.options, { ...f.dependencies, fetch: request }),
        ).rejects.toThrow('healthy serving version');
      });
      test(`refuses same-version origin routed to a different ${service} process`, async () => {
        const f = await fixture();
        const request = (async (input, init) => {
          const response = await f.dependencies.fetch(input, init);
          if (
            response.headers
              .get('Tale-Serving-Identity')
              ?.includes(`service=${service};`)
          )
            response.headers.set(
              'Tale-Serving-Identity',
              `v1;service=${service};instance=33333333-3333-4333-8333-333333333333`,
            );
          return response;
        }) as typeof fetch;
        await expect(
          acceptDeployment(f.options, { ...f.dependencies, fetch: request }),
        ).rejects.toThrow('healthy serving version');
      });
      test(`refuses ${service} process rollover without a Docker restart`, async () => {
        const f = await fixture();
        f.setHook((args) => {
          if (f.fetched() === 4 && args[0] === 'exec' && args.includes('bun'))
            f.instances[service] = '33333333-3333-4333-8333-333333333333';
        });
        await expect(
          acceptDeployment(f.options, f.dependencies),
        ).rejects.toThrow('Serving process changed');
      });
    }
    test('old version-only health cannot supply exact-origin acceptance', async () => {
      const f = await fixture();
      const request = (async (_input: string | URL | Request) =>
        Response.json({ status: 'ok', version: '1.2.3' })) as typeof fetch;
      await expect(
        acceptDeployment(f.options, { ...f.dependencies, fetch: request }),
      ).rejects.toThrow('healthy serving version');
    });
    test('elapsed bundle preparation cannot silently reset the external observation budget', async () => {
      const f = await fixture();
      let calls = 0;
      // This advances at the first external boundary, after the real bundle
      // has been privately copied and verified. Filesystem work itself has
      // size limits, not a cancellable wall-clock guarantee.
      await expect(
        acceptDeployment(f.options, {
          ...f.dependencies,
          now: () => (++calls === 1 ? 0 : 120_001),
        }),
      ).rejects.toThrow('managed runtime operation');
      expect(f.docker.calls).toHaveLength(0);
      // Custody cleanup and lock release are awaited even on budget refusal.
      await expect(
        acceptDeployment(f.options, f.dependencies),
      ).resolves.toMatchObject({ version: '1.2.3' });
    });
  },
);
