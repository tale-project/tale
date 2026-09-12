import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relative } from 'node:path';

import { platformConfigurationFixture } from '../config/platform-fixture';
import { resourceId } from '../config/platform-model';
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
import { prepareDeployment } from './prepare';
import { applyRuntime, prepareRuntime } from './runtime';
import { activateRuntimeConfiguration } from './runtime-apply';
import { ConfigurationDockerFixture } from './runtime-configuration-fixture';
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
  const configurationDocker = new ConfigurationDockerFixture(docker);
  const bundle = join(fixture.directory, 'deployment');
  fixture.options.bundleDirectory = join(bundle, 'runtime');
  const binary = join(fixture.directory, 'tale');
  const executable = Buffer.alloc(128);
  executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  executable.writeUInt16LE(62, 18);
  writeFileSync(binary, executable);
  // Ship the interpreted bundle beside the executable: copyDeploymentCli
  // requires it, and the backend-local provision phase runs it under bun.
  writeFileSync(`${binary}.mjs`, '#!/usr/bin/env bun\nprocess.exit(0);\n');
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
  let nativeFailureOutput = '';
  let copied = false;
  let owned = false;
  let cleanupFailure = false;
  let snapshotFailure = false;
  process.env.TALE_TEST_NATIVE_PASSWORD = 'synthetic-operator-password';
  process.env.TALE_TEST_UNUSED_SECRET = 'synthetic-unrelated-secret';
  const dependencies: NonNullable<Parameters<typeof applyDeployment>[1]> = {
    runtime: (options) =>
      applyRuntime(options, configurationDocker.dependencies()),
    activateConfiguration: (options, effect) =>
      activateRuntimeConfiguration(
        options,
        effect,
        configurationDocker.dependencies(),
      ),
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
      if (args.includes('stat')) return { ...ok, stdout: '1001:1001\n' };
      if (args.includes('provision')) {
        events.push('provision');
        // The backend-local phase runs as the owner of the data directory,
        // never as the container's root default, on a copy it owns.
        expect(args.indexOf('--user')).toBeGreaterThan(0);
        expect(args[args.indexOf('--user') + 1]).toBe('1001:1001');
        expect(args.indexOf('--user')).toBeLessThan(args.indexOf('deploy'));
        // Interpreted under the container's own bun, never the compiled
        // executable: `bun <temp>/cli/tale.mjs deploy provision …`.
        expect(args[args.indexOf('deploy') - 2]).toBe('bun');
        expect(args[args.indexOf('deploy') - 1]).toMatch(/\/cli\/tale\.mjs$/);
        expect(owned).toBe(true);
        expect(JSON.parse(options?.stdin ?? '{}')).toMatchObject({
          password: 'synthetic-operator-password',
          slug: 'example-team',
        });
        if (nativeFailure)
          return {
            ...ok,
            success: false,
            exitCode: 5,
            stdout: nativeFailureOutput,
            stderr: 'synthetic-operator-password',
          };
        return { ...ok, stdout: nativeOutput() };
      }
      if (args.includes('rm')) {
        events.push('cleanup');
        copied = false;
        owned = false;
        if (cleanupFailure) throw new Error('synthetic-cleanup-secret');
      } else if (args[0] === 'cp') {
        copied = true;
        // The interpreted bundle rides in the same private copy, so the
        // backend-local phase can run it under bun.
        expect(existsSync(join(args[1], 'cli/tale.mjs'))).toBe(true);
        nativeCopies.push({
          source: args[1],
          binary: readFileSync(join(args[1], 'cli/tale')),
        });
      } else if (args.includes('chown')) {
        expect(copied).toBe(true);
        expect(args.slice(2)).toEqual([
          'chown',
          '-R',
          '1001:1001',
          args.at(-1)!,
        ]);
        owned = true;
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
    configurationDocker,
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
    nativeFailure: (value: boolean, output = '') => {
      nativeFailure = value;
      nativeFailureOutput = output;
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

async function attachConfiguration(
  run: Awaited<ReturnType<typeof create>>,
  deployment = true,
) {
  run.spec.configuration = platformConfigurationFixture();
  if (!deployment)
    run.spec.configuration.resources = run.spec.configuration.resources.filter(
      (resource) => resource.kind !== 'deployment',
    );
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
  const desired = run.spec.configuration;
  const proof = {
    configured: true,
    target: {
      organizationId: run.native.organizationId,
      organizationSlug: run.spec.identity!.slug,
      origin: run.spec.origin,
    },
    deploymentBundleSha256: sha256(
      readFileSync(join(run.bundle, 'deployment.json')),
    ),
    configurationSha256: valueHash(desired),
    resources: desired.resources.map((resource) => ({
      id: resourceId(resource),
      configurationSha256: valueHash(resource.config),
      revision: 'a'.repeat(64),
    })),
    restartRequired: true,
    unchanged: false,
  };
  run.nativeOutput(() =>
    JSON.stringify({
      ok: true,
      command: 'deploy provision',
      data: { ...run.native, configuration: proof },
    }),
  );
  return proof;
}

// Real Git, file modes and runtime state require the supported POSIX host.
describePosix('complete managed deployment lifecycle', () => {
  test('passes explicit provider env references and preserves verified generic native platform configuration', async () => {
    const run = await create();
    const proof = await attachConfiguration(run);
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
    if (!('configurationActivation' in result))
      throw Error('Expected applied deployment');
    expect(result).toMatchObject({
      phase: 'ready',
      native: { configuration: proof },
      configurationActivation: { phase: 'ready' },
    });
    expect(run.events).toEqual(['up', 'provision', 'cleanup']);
    expect(JSON.stringify(result)).not.toContain(
      process.env.TALE_TEST_PROVIDER_KEY!,
    );
    expect(run.configurationDocker.restarted).toBe(1);
    proof.unchanged = true;
    proof.restartRequired = false;
    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      configurationActivation: result.configurationActivation,
      native: { configuration: { unchanged: true, restartRequired: false } },
    });
    expect(run.configurationDocker.restarted).toBe(1);
  }, 30000);
  test.each(['before', 'after'] as const)(
    'configuration restart failure %s acceptance retains master pending and recovers even when the native resource is now unchanged',
    async (failure) => {
      const run = await create();
      const proof = await attachConfiguration(run);
      run.configurationDocker.restartFailure = failure;
      await expect(run.apply()).rejects.toThrow('Docker could not');
      expect(existsSync(run.receiptPath)).toBe(false);
      const pendingPath = join(
        run.fixture.options.stateDirectory,
        '.tale/deployment-pending.json',
      );
      const pending = readFileSync(pendingPath);
      const activationPath = join(
        run.fixture.options.stateDirectory,
        '.tale/configuration-runtime.json',
      );
      const activation = JSON.parse(readFileSync(activationPath, 'utf8'));
      expect(activation.phase).toBe('pending');
      proof.unchanged = true;
      proof.restartRequired = false;
      run.configurationDocker.restartFailure = undefined;
      const ready = await run.apply();
      if (!('configurationActivation' in ready))
        throw Error('Expected applied deployment');
      expect(ready).toMatchObject({
        phase: 'ready',
        native: { configuration: proof },
        configurationActivation: { phase: 'ready', before: activation.before },
      });
      expect(run.configurationDocker.restarted).toBe(1);
      expect(existsSync(pendingPath)).toBe(false);
      expect(JSON.parse(pending.toString()).bundleSha256).toBe(
        ready.bundleSha256,
      );
      expect(await run.apply()).toMatchObject({
        phase: 'ready',
        configurationActivation: ready.configurationActivation,
      });
      expect(run.configurationDocker.restarted).toBe(1);
    },
  );
  test('hot configuration resources preserve native proof without restarting the spawner', async () => {
    const run = await create();
    const proof = await attachConfiguration(run, false);
    proof.restartRequired = false;
    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      native: { configuration: proof },
    });
    expect(run.configurationDocker.restarted).toBe(0);
    expect(
      existsSync(
        join(
          run.fixture.options.stateDirectory,
          '.tale/configuration-runtime.json',
        ),
      ),
    ).toBe(false);
    expect(run.docker.calls.some(({ args }) => args.at(-1) === 'drain')).toBe(
      false,
    );
  });
  test.each([
    'missing',
    'organization',
    'bundle',
    'settings',
    'model',
    'policy',
  ] as const)(
    'refuses %s native platform configuration evidence before a ready deployment receipt',
    async (kind) => {
      const run = await create();
      const proof = await attachConfiguration(run);
      const changed: Record<string, unknown> = structuredClone(proof);
      if (kind === 'organization')
        changed.target = { ...proof.target, organizationId: 'another-org' };
      if (kind === 'bundle') changed.deploymentBundleSha256 = 'f'.repeat(64);
      if (kind === 'settings') changed.configurationSha256 = 'f'.repeat(64);
      if (kind === 'model') changed.resources = [];
      if (kind === 'policy')
        changed.resources = proof.resources.map((resource) =>
          Object.assign({}, resource, {
            configurationSha256: 'f'.repeat(64),
          }),
        );
      run.nativeOutput(() =>
        JSON.stringify({
          ok: true,
          command: 'deploy provision',
          data: {
            ...run.native,
            configuration: kind === 'missing' ? undefined : changed,
          },
        }),
      );
      await expect(run.apply()).rejects.toThrow('configuration receipt');
      expect(existsSync(run.receiptPath)).toBe(false);
      expect(run.events.at(-1)).toBe('cleanup');
    },
    30000,
  );
  test('missing required provider secret stops before runtime or native mutation', async () => {
    const run = await create();
    await attachConfiguration(run);
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

  test('a failing backend-local phase repeats its own summary and never its stderr', async () => {
    const run = await create(true);
    run.nativeFailure(
      true,
      JSON.stringify({
        ok: false,
        command: 'tale',
        error: {
          summary: 'Native deployment state has an unsafe directory or owner.',
          code: 4,
        },
      }),
    );
    let failure: unknown;
    await run.apply().catch((error: unknown) => {
      failure = error;
    });
    expect(String(failure)).toContain(
      'did not complete provisioning. Its previous receipts are retained for recovery. It reported: Native deployment state has an unsafe directory or owner. (exit 4)',
    );
    expect(String(failure)).not.toContain('synthetic-operator-password');
  });

  test('a reviewed bundle supersedes the pending one and keeps its recovery snapshot', async () => {
    const run = await create(true);
    run.nativeFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    const intentPath = join(
      run.fixture.options.stateDirectory,
      '.tale/deployment-pending.json',
    );
    const pending = JSON.parse(readFileSync(intentPath, 'utf8'));
    const original = await verifyDeploymentBundle(run.bundle);
    const rewrite = async (supersedesPendingBundle: string) => {
      rmSync(join(run.bundle, 'deployment.json'));
      await writeDeploymentBundle(run.bundle, {
        schemaVersion: 1,
        kind: 'tale-deployment',
        cli: original.cli,
        spec: { ...original.spec, supersedesPendingBundle },
        deploymentRef: 'd'.repeat(40),
      });
    };
    // Naming any bundle but the pending one keeps the refusal, which names it.
    await rewrite('e'.repeat(64));
    run.events.length = 0;
    await expect(run.apply()).rejects.toThrow(
      `different deployment bundle is pending (${pending.bundleSha256})`,
    );
    expect(run.events).toEqual([]);
    await rewrite(pending.bundleSha256);
    run.nativeFailure(false);
    const result = await run.apply();
    expect(result).toMatchObject({
      snapshotId: pending.snapshot.id,
      supersededBundles: [pending.bundleSha256],
      runtimeChanged: false,
    });
    expect(run.events).toEqual(['verify-snapshot', 'provision', 'cleanup']);
    expect(existsSync(intentPath)).toBe(false);
    expect(
      JSON.parse(readFileSync(run.receiptPath, 'utf8')).supersededBundles,
    ).toEqual([pending.bundleSha256]);
    // A lingering declaration is a warning, not a refusal.
    expect(await run.apply()).toMatchObject({
      snapshotId: pending.snapshot.id,
    });
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
