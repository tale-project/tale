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
  let hook: (args: string[]) => void = () => {};
  const run: typeof exec = async (command, args, options) => {
    hook(args);
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
    expect(url).toBe(`${spec.origin}/api/health`);
    return Response.json({ status: 'ok', version: '1.2.3' });
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
      expect(f.fetched()).toBe(1);
      expect(
        f.docker.calls.every((c) =>
          ['info', 'network', 'ps', 'container', 'image'].includes(c.args[0]!),
        ),
      ).toBe(true);
    }, 30_000);
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
    for (const mutation of ['restart', 'ready', 'ledger', 'topology'] as const)
      test(`refuses ${mutation} changes during observation`, async () => {
        const f = await fixture();
        let queries = 0;
        f.setHook((args) => {
          if (args[0] === 'exec' && ++queries === 3) {
            if (mutation === 'restart')
              f.docker.containers[0]!.RestartCount = 1;
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
    test('whole deadline refuses after a slow observation', async () => {
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
  },
);
