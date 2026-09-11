import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relative } from 'node:path';

import { sha256, valueHash, loadClient } from '../config/releases/identity';
import { loadRelease } from '../config/releases/manifest';
import { commandFixture } from '../config/releases/tests/command-fixture';
import { applyDeployment } from './apply';
import { verifyDeploymentBundle, writeDeploymentBundle } from './bundle';
import {
  buildCapsuleStage,
  prepareDeploymentConfig,
  verifyPreparedDeploymentConfig,
} from './config-source';
import { deploymentSpecSchema } from './model';
import { modelSettingsFixture } from './model-settings-fixture';
import { prepareDeployment } from './prepare';
import { applyRuntime, prepareRuntime } from './runtime';
import {
  installLegacy,
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';
import { TALE_REPOSITORY, withDeploymentSources } from './sources';

const describePosix = describe.skipIf(process.platform === 'win32');

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
  delete process.env.TALE_TEST_NATIVE_PASSWORD;
  delete process.env.TALE_TEST_UNUSED_SECRET;
  delete process.env.TALE_TEST_PROVIDER_KEY;
});

/** Real Git, staging, manifests, state files and lock; only the Docker boundary
 * and backup I/O are simulated. Native HTTP has its own subprocess suite. */
async function create(legacy = false, identity = true) {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  const bundle = join(fixture.directory, 'deployment');
  fixture.options.bundleDirectory = join(bundle, 'runtime');
  const binary = join(fixture.directory, 'tale');
  const executable = Buffer.alloc(128);
  executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  executable.writeUInt16LE(62, 18);
  writeFileSync(binary, executable);
  const spec = deploymentSpecSchema.parse({
    schemaVersion: 1,
    name: fixture.options.name,
    stateDirectory: fixture.options.stateDirectory,
    composeProject: fixture.options.composeProject,
    origin: fixture.options.origin,
    tlsMode: 'external',
    runtime: { revision: fixture.revision },
    ...(identity
      ? {
          identity: {
            email: 'operator@example.invalid',
            password: { env: 'TALE_TEST_NATIVE_PASSWORD' },
            slug: 'example-team',
            name: 'Example team',
            ssoEnabled: false,
            nativeClients: [
              {
                key: 'portal',
                name: 'Example portal',
                clientId: 'native-client',
                redirectUris: ['https://portal.example.invalid/callback'],
              },
            ],
          },
        }
      : {}),
  });
  const specPath = join(fixture.directory, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const sourcesFile = join(fixture.directory, 'sources.json');
  writeFileSync(
    sourcesFile,
    JSON.stringify({
      [`${TALE_REPOSITORY}@${fixture.revision}`]: fixture.repoRoot,
    }),
  );
  const preparation = {
    spec: specPath,
    output: bundle,
    sourcesFile,
    deploymentRef: 'c'.repeat(40),
  };
  const prepareDependencies: NonNullable<
    Parameters<typeof prepareDeployment>[1]
  > = {
    build: () => ({ revision: 'a'.repeat(40), binary }),
    // Other Docker unit suites mock the shared exec module. Keep this
    // integration proof on real Git regardless of their module load order.
    sources: (requests, options, work) =>
      withDeploymentSources(
        requests,
        {
          ...options,
          run: async (command, args, execution) => {
            expect(command).toBe('git');
            const child = Bun.spawn([command, ...args], {
              cwd: execution?.cwd,
              env: execution?.env,
              stdout: 'pipe',
              stderr: 'pipe',
            });
            const [stdout, stderr, exitCode] = await Promise.all([
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
              child.exited,
            ]);
            return { stdout, stderr, exitCode, success: exitCode === 0 };
          },
        },
        work,
      ),
    runtime: (options: Parameters<typeof prepareRuntime>[0]) =>
      prepareRuntime(options, docker.dependencies()),
  };
  await prepareDeployment(preparation, prepareDependencies);
  const prior = legacy ? installLegacy(fixture, docker) : undefined;
  docker.calls = [];
  const events: string[] = [];
  const nativeCopies: { source: string; binary: Buffer }[] = [];
  docker.onUp = () => {
    events.push('up');
  };
  const native = {
    organizationId: 'native-organization',
    organizationSlug: 'example-team',
    userId: 'native-user',
    ssoEnabled: false,
    nativeClients: [
      { key: 'portal', clientId: 'native-client', changed: false },
    ],
    configs: [],
    ignoredSecret: 'synthetic-response-secret',
  };
  let nativeOutput = () =>
    JSON.stringify({ ok: true, command: 'deploy provision', data: native });
  let nativeFailure = false;
  let cleanupFailure = false;
  let snapshotFailure = false;
  process.env.TALE_TEST_NATIVE_PASSWORD = 'synthetic-operator-password';
  process.env.TALE_TEST_UNUSED_SECRET = 'synthetic-unrelated-secret';
  const dependencies: NonNullable<Parameters<typeof applyDeployment>[1]> = {
    runtime: (options) => applyRuntime(options, docker.dependencies()),
    snapshot: async (options) => {
      events.push('snapshot');
      expect(options.prefix).toBe('tale_');
      // The real snapshot helper creates this separate project-owned volume.
      // Subsequent runtime admission must preserve and recognize it.
      if (!docker.volumes.includes('tale_backups'))
        docker.volumes.push('tale_backups');
      return {
        id: '20260910-000000-deploy',
        createdAt: '2026-09-10T00:00:00Z',
        cliVersion: 'dev',
        platformVersion: null,
        trigger: 'deploy',
        volumes: { 'db-data': { sha256: '0'.repeat(64), sizeBytes: 1 } },
      };
    },
    verifySnapshot: async () => {
      events.push('verify-snapshot');
      if (snapshotFailure) throw new Error('Snapshot verification failed');
    },
    exec: async (command, args, options) => {
      expect(command).toBe('docker');
      expect(options?.env).not.toHaveProperty('TALE_TEST_NATIVE_PASSWORD');
      expect(options?.env).not.toHaveProperty('TALE_TEST_UNUSED_SECRET');
      expect(args.join(' ')).not.toContain('synthetic-operator-password');
      const ok = { success: true, exitCode: 0, stdout: '', stderr: '' };
      if (args.includes('provision')) {
        events.push('provision');
        expect(JSON.parse(options?.stdin ?? '{}')).toMatchObject({
          password: 'synthetic-operator-password',
          slug: 'example-team',
        });
        if (nativeFailure)
          return {
            ...ok,
            success: false,
            exitCode: 5,
            stderr: 'synthetic-operator-password',
          };
        return { ...ok, stdout: nativeOutput() };
      }
      if (args.includes('rm')) {
        events.push('cleanup');
        if (cleanupFailure) throw new Error('synthetic-cleanup-secret');
      } else if (args[0] === 'cp') {
        nativeCopies.push({
          source: args[1],
          binary: readFileSync(join(args[1], 'cli/tale')),
        });
      } else expect(args.includes('mkdir')).toBe(true);
      return ok;
    },
  };
  const receiptPath = join(
    fixture.options.stateDirectory,
    '.tale/deployment-ready.json',
  );
  return {
    fixture,
    docker,
    bundle,
    preparation,
    prepareDependencies,
    spec,
    prior,
    native,
    events,
    nativeCopies,
    dependencies,
    receiptPath,
    apply: (dryRun = false) =>
      applyDeployment({ bundle, dryRun }, dependencies),
    nativeOutput: (value: typeof nativeOutput) => {
      nativeOutput = value;
    },
    nativeFailure: (value: boolean) => {
      nativeFailure = value;
    },
    cleanupFailure: (value: boolean) => {
      cleanupFailure = value;
    },
    snapshotFailure: (value: boolean) => {
      snapshotFailure = value;
    },
  };
}

describePosix('fresh native receipt custody', () => {
  test('late owner, managed credentials and explicit attestation must match before ready; recovery and replay retain exact artifact proof', async () => {
    const run = await create();
    const metadata = await verifyDeploymentBundle(run.bundle);
    const source = commandFixture('north-labs');
    const configDirectory = join(run.bundle, 'configs/north-labs', source.name);
    await prepareDeploymentConfig({
      repoRoot: source.root,
      descriptorPath: relative(source.root, source.descriptorPath),
      automationName: source.name,
      configRef: source.options.sourceCommit,
      catalogueRepository: source.descriptor.sourceRepository,
      clientId: 'north-labs',
      deploymentRef: metadata.deploymentRef,
      output: configDirectory,
      lateOwner: true,
    });
    const selected = await verifyPreparedDeploymentConfig(configDirectory);
    if (selected.kind !== 'source') throw new Error('Expected source capsule');
    const expected = await buildCapsuleStage(
      configDirectory,
      join(run.fixture.directory, 'independent-native-build'),
      run.native.userId,
    );
    const artifact = loadRelease(
      expected.manifestPath,
      loadClient(expected.descriptorPath, source.name),
    ).manifest.artifact.sha256;
    run.spec.identity!.bootstrap = 'fresh';
    run.spec.identity!.emailVerification = 'operator-attested';
    run.spec.identity!.nativeClients = [
      {
        key: 'portal',
        name: 'Example portal',
        managed: true,
        redirectUris: ['https://portal.example.invalid/callback'],
      },
    ];
    run.spec.configs = [
      {
        repository: source.descriptor.sourceRepository,
        revision: source.options.sourceCommit,
        client: 'north-labs',
        descriptor: relative(source.root, source.descriptorPath),
        automation: source.name,
        project: { key: 'NORTH', name: 'North document desk' },
        skillOwner: 'operator',
      },
    ];
    rmSync(join(run.bundle, 'deployment.json'));
    await writeDeploymentBundle(run.bundle, {
      schemaVersion: 1,
      kind: 'tale-deployment',
      cli: metadata.cli,
      deploymentRef: metadata.deploymentRef,
      spec: run.spec,
    });
    rmSync(source.root, { recursive: true, force: true });
    const privateRoot = `/app/data/ops/tale-deployments/${run.spec.name}/private`;
    const native = {
      ...run.native,
      emailVerification: {
        method: 'operator-attested',
        userId: run.native.userId,
        email: 'operator@example.invalid',
        emailVerified: true,
        receipt: {
          path: `${privateRoot}/email-attestation.json`,
          sha256: 'e'.repeat(64),
        },
      },
      nativeClients: [
        {
          key: 'portal',
          clientId: 'fresh-native-id',
          changed: true,
          credentials: {
            path: `${privateRoot}/client-portal.json`,
            sha256: 'a'.repeat(64),
          },
        },
      ],
      configs: [
        {
          clientId: 'north-labs',
          automationName: source.name,
          releaseRef: source.options.sourceCommit,
          sourceCommit: source.options.sourceCommit,
          sourceRepository: source.descriptor.sourceRepository,
          artifactSha256: artifact,
          automationVersion: 17,
          unchanged: false,
          projectId: 'fresh-native-project',
          skillOwnerUserId: run.native.userId,
          sourceCapsuleSha256: selected.capsuleSha256,
        },
      ],
    };
    const execute = run.dependencies.exec!;
    run.dependencies.exec = async (command, args, options) => {
      if (args.includes('provision'))
        expect(JSON.parse(options?.stdin ?? '{}')).toMatchObject({
          bootstrap: 'fresh',
          emailVerification: 'operator-attested',
          nativeClients: [{ managed: true }],
        });
      return execute(command, args, options);
    };
    for (const changed of [
      { ...native, emailVerification: undefined },
      {
        ...native,
        emailVerification: {
          ...native.emailVerification,
          userId: 'different-user',
        },
      },
      {
        ...native,
        emailVerification: {
          ...native.emailVerification,
          email: 'different@example.org',
        },
      },
      {
        ...native,
        emailVerification: {
          ...native.emailVerification,
          receipt: {
            ...native.emailVerification.receipt,
            path: '/private/unrelated.json',
          },
        },
      },
      {
        ...native,
        nativeClients: [{ ...native.nativeClients[0], credentials: undefined }],
      },
      ...[
        { projectId: undefined },
        { skillOwnerUserId: 'wrong_owner' },
        { sourceCapsuleSha256: '1'.repeat(64) },
        { artifactSha256: '2'.repeat(64) },
      ].map((change) =>
        Object.assign({}, native, {
          configs: [Object.assign({}, native.configs[0], change)],
        }),
      ),
    ]) {
      run.nativeOutput(() =>
        JSON.stringify({
          ok: true,
          command: 'deploy provision',
          data: changed,
        }),
      );
      const failure = await run.apply().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (run.events.at(-1) !== 'cleanup') throw failure;
      expect(existsSync(run.receiptPath)).toBe(false);
      expect(run.events.at(-1)).toBe('cleanup');
    }
    run.nativeOutput(() =>
      JSON.stringify({ ok: true, command: 'deploy provision', data: native }),
    );
    const ready = await run.apply();
    expect(ready).toMatchObject({
      phase: 'ready',
      configs: [
        {
          artifactSha256: artifact,
          sourceCapsuleSha256: selected.capsuleSha256,
        },
      ],
    });
    const receipt = JSON.parse(readFileSync(run.receiptPath, 'utf8'));
    expect(receipt.native.emailVerification).toEqual(native.emailVerification);
    expect(JSON.stringify(receipt)).not.toContain('synthetic-response-secret');
    const ups = run.events.filter((event) => event === 'up').length;
    const replay = await run.apply();
    expect(replay).toMatchObject({ phase: 'ready', runtimeChanged: false });
    expect(run.events.filter((event) => event === 'up')).toHaveLength(ups);
  }, 30_000);
});

async function attachModelSettings(run: Awaited<ReturnType<typeof create>>) {
  run.spec.modelSettings = modelSettingsFixture();
  run.spec.environment.TALE_PROVIDER_KEY_EXAMPLE = {
    env: 'TALE_TEST_PROVIDER_KEY',
  };
  const metadata = JSON.parse(
    readFileSync(join(run.bundle, 'deployment.json'), 'utf8'),
  );
  rmSync(join(run.bundle, 'deployment.json'));
  await writeDeploymentBundle(run.bundle, {
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: metadata.cli,
    deploymentRef: metadata.deploymentRef,
    spec: run.spec,
  });
  process.env.TALE_TEST_PROVIDER_KEY = 'synthetic-external-provider-secret';
  const desired = run.spec.modelSettings;
  const proof = {
    configured: true,
    organizationId: run.native.organizationId,
    organizationSlug: run.spec.identity!.slug,
    deploymentBundleSha256: sha256(
      readFileSync(join(run.bundle, 'deployment.json')),
    ),
    settingsSha256: valueHash(desired),
    providers: desired.providers.map(({ definition, models }) => ({
      name: definition.name,
      models: models.map((model) => model.id),
      providerFileSha256: 'a'.repeat(64),
    })),
    vision: desired.vision ?? null,
    embedding: desired.embedding ?? null,
    unchanged: false,
  };
  run.nativeOutput(() =>
    JSON.stringify({
      ok: true,
      command: 'deploy provision',
      data: { ...run.native, modelSettings: proof },
    }),
  );
  return proof;
}

// Real Git, file modes and runtime state require the supported POSIX host.
describePosix('complete managed deployment lifecycle', () => {
  test('passes explicit provider env references and preserves verified generic native model settings', async () => {
    const run = await create();
    const proof = await attachModelSettings(run);
    const runtime = run.dependencies.runtime!;
    run.dependencies.runtime = async (options) => {
      expect(options.environment?.TALE_PROVIDER_KEY_EXAMPLE).toBe(
        process.env.TALE_TEST_PROVIDER_KEY,
      );
      expect(options.environment).not.toHaveProperty(
        'TALE_ALLOW_PRIVATE_PROVIDER_HOSTS',
      );
      return runtime(options);
    };
    const result = await run.apply();
    expect(result).toMatchObject({
      phase: 'ready',
      native: { modelSettings: proof },
    });
    expect(run.events).toEqual(['up', 'provision', 'cleanup']);
    expect(JSON.stringify(result)).not.toContain(
      process.env.TALE_TEST_PROVIDER_KEY!,
    );
  }, 30000);
  test.each([
    'missing',
    'organization',
    'bundle',
    'settings',
    'model',
    'policy',
  ] as const)(
    'refuses %s native model settings evidence before a ready deployment receipt',
    async (kind) => {
      const run = await create();
      const proof = await attachModelSettings(run);
      const changed: Record<string, unknown> = structuredClone(proof);
      if (kind === 'organization') changed.organizationId = 'another-org';
      if (kind === 'bundle') changed.deploymentBundleSha256 = 'f'.repeat(64);
      if (kind === 'settings') changed.settingsSha256 = 'f'.repeat(64);
      if (kind === 'model') changed.providers = [];
      if (kind === 'policy')
        changed.vision = { providerSlug: 'hosted', modelId: 'fallback' };
      run.nativeOutput(() =>
        JSON.stringify({
          ok: true,
          command: 'deploy provision',
          data: {
            ...run.native,
            modelSettings: kind === 'missing' ? undefined : changed,
          },
        }),
      );
      await expect(run.apply()).rejects.toThrow('model settings receipt');
      expect(existsSync(run.receiptPath)).toBe(false);
      expect(run.events.at(-1)).toBe('cleanup');
    },
    30000,
  );
  test('missing required provider secret stops before runtime or native mutation', async () => {
    const run = await create();
    await attachModelSettings(run);
    delete process.env.TALE_TEST_PROVIDER_KEY;
    await expect(run.apply()).rejects.toThrow('environment variable');
    expect(run.events).toEqual([]);
    expect(existsSync(run.receiptPath)).toBe(false);
  }, 30000);
  test('a bundle modified during rollout cannot replace the executable receiving private credentials', async () => {
    const run = await create();
    const original = readFileSync(join(run.bundle, 'cli/tale'));
    const runtime = run.dependencies.runtime!;
    run.dependencies.runtime = async (options) => {
      const result = await runtime(options);
      if (!options.dryRun)
        writeFileSync(
          join(run.bundle, 'cli/tale'),
          'changed executable after initial verification',
        );
      return result;
    };
    expect(await run.apply()).toMatchObject({ phase: 'ready' });
    expect(run.nativeCopies).toHaveLength(1);
    expect(run.nativeCopies[0]?.binary).toEqual(original);
    expect(run.nativeCopies[0]?.source).not.toBe(`${run.bundle}/.`);
    expect(existsSync(run.nativeCopies[0]!.source)).toBe(false);
    await expect(run.apply()).rejects.toThrow('bytes');
  });

  test('recovery retains and re-verifies the original pre-deployment snapshot through a native failure', async () => {
    const run = await create(true);
    run.nativeFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    const intentPath = join(
      run.fixture.options.stateDirectory,
      '.tale/deployment-pending.json',
    );
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    expect(intent.snapshot.id).toBe('20260910-000000-deploy');
    expect(existsSync(run.receiptPath)).toBe(false);
    run.events.length = 0;
    run.nativeFailure(false);
    const result = await run.apply();
    expect(result).toMatchObject({
      snapshotId: intent.snapshot.id,
      runtimeChanged: false,
    });
    expect(run.events).toEqual(['verify-snapshot', 'provision', 'cleanup']);
    expect(existsSync(intentPath)).toBe(false);
    expect(await run.apply()).toMatchObject({
      snapshotId: intent.snapshot.id,
      runtimeChanged: false,
    });
  });

  test('a failed native deployment must recover the same bundle before applying a different one', async () => {
    const run = await create(true);
    run.nativeFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    const original = await verifyDeploymentBundle(run.bundle);
    rmSync(join(run.bundle, 'deployment.json'));
    await writeDeploymentBundle(run.bundle, {
      schemaVersion: 1,
      kind: 'tale-deployment',
      cli: original.cli,
      spec: original.spec,
      deploymentRef: 'd'.repeat(40),
    });
    run.events.length = 0;
    await expect(run.apply()).rejects.toThrow(
      'different deployment bundle is pending',
    );
    expect(run.events).toEqual([]);
  });

  test('preparation binds real source commits, retains only secret references and refuses output reuse', async () => {
    const run = await create();
    const bundle = await verifyDeploymentBundle(run.bundle, {
      cliRef: 'a'.repeat(40),
      deploymentRef: 'c'.repeat(40),
    });
    expect(bundle.spec.runtime.revision).toBe(run.fixture.revision);
    expect(JSON.stringify(bundle)).not.toContain('synthetic-operator-password');
    expect(bundle.spec.identity?.password).toEqual({
      env: 'TALE_TEST_NATIVE_PASSWORD',
    });
    expect(bundle.files.some((file) => file.path.includes('.git'))).toBe(false);
    await expect(
      prepareDeployment(run.preparation, run.prepareDependencies),
    ).rejects.toThrow('already exists');
    expect(run.events).toEqual([]);
  });

  test('preview reads fresh and adopted state without a lock, backup, native call or mutation', async () => {
    for (const legacy of [false, true]) {
      const run = await create(legacy);
      expect(await run.apply(true)).toMatchObject({
        dryRun: true,
        runtime: { existing: legacy },
      });
      expect(run.events).toEqual([]);
      expect(
        existsSync(join(run.fixture.options.stateDirectory, '.tale')),
      ).toBe(false);
      expect(
        run.docker.calls.some(
          ({ args }) =>
            args[0] === 'pull' || args[0] === 'tag' || args.includes('up'),
        ),
      ).toBe(false);
    }
  });

  test('adoption verifies a recovery snapshot before rollout and records only verified public native proof', async () => {
    const run = await create(true);
    const result = await run.apply();
    expect(run.events).toEqual([
      'snapshot',
      'verify-snapshot',
      'up',
      'provision',
      'cleanup',
    ]);
    expect(result).toMatchObject({
      phase: 'ready',
      runtimeChanged: true,
      snapshotId: '20260910-000000-deploy',
    });
    const receipt = readFileSync(run.receiptPath, 'utf8');
    expect(receipt).not.toContain('synthetic-response-secret');
    expect(receipt).not.toContain('synthetic-operator-password');
    expect(
      readFileSync(
        join(run.fixture.options.stateDirectory, 'secrets.env'),
        'utf8',
      ),
    ).toBe(run.prior!.secrets);
    run.events.length = 0;
    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      runtimeChanged: false,
    });
    expect(run.events).toEqual(['provision', 'cleanup']);
  });

  test('a runtime-only instance uses the same lifecycle without a native identity', async () => {
    const run = await create(false, false);
    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      runtimeChanged: true,
    });
    expect(run.events).toEqual(['up']);
    expect(
      JSON.parse(readFileSync(run.receiptPath, 'utf8')).native,
    ).toBeUndefined();
  });

  test('missing environment and a corrupt bundle are refused before Docker or state creation', async () => {
    const run = await create();
    delete process.env.TALE_TEST_NATIVE_PASSWORD;
    await expect(run.apply()).rejects.toThrow('TALE_TEST_NATIVE_PASSWORD');
    expect(run.docker.calls).toEqual([]);
    expect(existsSync(run.fixture.options.stateDirectory)).toBe(false);
    writeFileSync(join(run.bundle, 'runtime/compose.yml'), 'corrupted');
    await expect(run.apply()).rejects.toThrow('bytes');
    expect(run.docker.calls).toEqual([]);
  });

  test('a failed snapshot refuses rollout and releases the lock for a corrected retry', async () => {
    const run = await create(true);
    run.snapshotFailure(true);
    await expect(run.apply()).rejects.toThrow('Snapshot verification failed');
    expect(run.events).toEqual(['snapshot', 'verify-snapshot']);
    expect(existsSync(run.receiptPath)).toBe(false);
    run.snapshotFailure(false);
    expect(await run.apply()).toMatchObject({ phase: 'ready' });
  });

  test('native failure retains the previous ready receipt, scrubs stderr, cleans its temporary and permits retry', async () => {
    const run = await create();
    await run.apply();
    const previous = readFileSync(run.receiptPath);
    run.nativeFailure(true);
    run.cleanupFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    expect(readFileSync(run.receiptPath)).toEqual(previous);
    expect(run.events.at(-1)).toBe('cleanup');
    run.nativeFailure(false);
    run.cleanupFailure(false);
    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      runtimeChanged: false,
    });
  });

  test('wrong native identity, client proof and invalid JSON never produce a ready receipt', async () => {
    const run = await create();
    for (const value of [
      JSON.stringify({
        ok: true,
        command: 'deploy provision',
        data: { ...run.native, organizationSlug: 'other-team' },
      }),
      JSON.stringify({
        ok: true,
        command: 'deploy provision',
        data: { ...run.native, nativeClients: [] },
      }),
      JSON.stringify({
        ok: true,
        command: 'deploy provision',
        data: {
          ...run.native,
          nativeClients: [
            { key: 'other-client', clientId: 'native-client', changed: true },
          ],
        },
      }),
      'not json',
      'x'.repeat(1_048_577),
    ]) {
      run.nativeOutput(() => value);
      await expect(run.apply()).rejects.toThrow();
      expect(existsSync(run.receiptPath)).toBe(false);
      expect(run.events.at(-1)).toBe('cleanup');
    }
    run.nativeOutput(() =>
      JSON.stringify({
        ok: true,
        command: 'deploy provision',
        data: run.native,
      }),
    );
    expect(await run.apply()).toMatchObject({ phase: 'ready' });
  });
});
