import {
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relative } from 'node:path';

import { resourceId } from '@tale/shared/config/platform-resources';

import { platformConfigurationFixture } from '../../../../../packages/shared/src/config/platform-resources.fixture';
import { CliError, ExitCode } from '../../utils/fail';
import * as logger from '../../utils/logger';
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
import {
  activateRuntimeConfiguration,
  observeReadyRuntime,
} from './runtime-apply';
import { ConfigurationDockerFixture } from './runtime-configuration-fixture';
import { parseRuntimeEnvironment } from './runtime-env';
import { readRuntimeBundle } from './runtime-model';
import {
  installLegacy,
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';
import { TALE_REPOSITORY, withDeploymentSources } from './sources';

// Tests here build the git runtime fixture (four git spawns per build);
// Windows CI runners stall on git for seconds at a time, and the 5 s
// default killed a passing test mid-commit.
setDefaultTimeout(30_000);

const describePosix = describe.skipIf(process.platform === 'win32');

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
  delete process.env.TALE_TEST_NATIVE_PASSWORD;
  delete process.env.TALE_TEST_UNUSED_SECRET;
  delete process.env.TALE_TEST_PROVIDER_KEY;
  delete process.env.TALE_TEST_BREAK_GLASS_EMAIL;
  delete process.env.TALE_TEST_BREAK_GLASS_HASH;
});
const BREAK_GLASS_HASH = `${'c'.repeat(32)}:${'d'.repeat(128)}`;

/** Real Git, staging, manifests, state files and lock; only the Docker boundary
 * and backup I/O are simulated. Native HTTP has its own subprocess suite. */
async function create(
  legacy = false,
  identity = true,
  additionalOrigins?: string[],
  organizationCreators?: string[],
) {
  const fixture = runtimeFixture({
    trustsTerminator: additionalOrigins !== undefined,
  });
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
    ...(additionalOrigins ? { additionalOrigins } : {}),
    ...(organizationCreators
      ? { organizations: { creators: organizationCreators } }
      : {}),
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
  const nativeCommands: string[][] = [];
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
  let snapshotWithoutGateway = false;
  process.env.TALE_TEST_NATIVE_PASSWORD = 'synthetic-operator-password';
  process.env.TALE_TEST_UNUSED_SECRET = 'synthetic-unrelated-secret';
  const dependencies: NonNullable<Parameters<typeof applyDeployment>[1]> = {
    runtime: (options) =>
      applyRuntime(options, configurationDocker.dependencies()),
    observeRuntime: (options) =>
      observeReadyRuntime(options, configurationDocker.dependencies()),
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
        volumes: {
          'db-data': { sha256: '0'.repeat(64), sizeBytes: 1 },
          // Like the real snapshot: the gateway store whenever its volume
          // exists, unless the test stands in for a CLI that predates that.
          ...(docker.volumes.includes('tale_llm-gateway-data') &&
          !snapshotWithoutGateway
            ? {
                'llm-gateway-data': { sha256: '1'.repeat(64), sizeBytes: 1 },
              }
            : {}),
        },
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
        nativeCommands.push([...args]);
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
    nativeCommands,
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
    snapshotWithoutGateway: (value: boolean) => {
      snapshotWithoutGateway = value;
    },
  };
}

describePosix('fresh native receipt custody', () => {
  test('a container-prefix rollout retains deployment identity, snapshots before recreation and preserves native IDs', async () => {
    const run = await create(true);
    await run.apply();
    const ready = JSON.parse(readFileSync(run.receiptPath, 'utf8'));
    const secrets = readFileSync(
      join(run.fixture.options.stateDirectory, 'secrets.env'),
    );
    const prefixBundle = join(run.fixture.directory, 'prefixed-deployment');
    writeFileSync(
      run.preparation.spec,
      JSON.stringify({
        ...run.spec,
        runtime: { ...run.spec.runtime, containerPrefix: 'north-desk-prod' },
      }),
    );
    await prepareDeployment(
      { ...run.preparation, output: prefixBundle },
      run.prepareDependencies,
    );
    run.events.length = 0;
    await applyDeployment({ bundle: prefixBundle }, run.dependencies);
    expect(run.events.indexOf('snapshot')).toBeLessThan(
      run.events.indexOf('up'),
    );
    expect(run.events.filter((event) => event === 'snapshot')).toHaveLength(1);
    const renamed = JSON.parse(readFileSync(run.receiptPath, 'utf8'));
    expect(renamed.name).toBe(ready.name);
    expect(renamed.native).toEqual(ready.native);
    expect(
      readFileSync(join(run.fixture.options.stateDirectory, 'secrets.env')),
    ).toEqual(secrets);
    expect(
      run.docker.containers.every((container) =>
        String(container.Name).startsWith('/north-desk-prod-'),
      ),
    ).toBe(true);
    run.events.length = 0;
    await applyDeployment({ bundle: prefixBundle }, run.dependencies);
    expect(run.events).not.toContain('up');
    expect(run.events).not.toContain('snapshot');
  });

  test('a missing or malformed break-glass hash refuses before destination access', async () => {
    const run = await create();
    const metadata = await verifyDeploymentBundle(run.bundle);
    run.spec.identity!.breakGlass = {
      email: 'break-glass@example.invalid',
      passwordHash: { env: 'TALE_TEST_BREAK_GLASS_HASH' },
    };
    rmSync(join(run.bundle, 'deployment.json'));
    await writeDeploymentBundle(run.bundle, { ...metadata, spec: run.spec });
    for (const [value, message] of [
      [undefined, 'TALE_TEST_BREAK_GLASS_HASH is missing'],
      ['synthetic-not-a-hash', 'Invalid native instance provisioning input.'],
      [
        BREAK_GLASS_HASH.toUpperCase(),
        'Invalid native instance provisioning input.',
      ],
    ] as const) {
      if (value === undefined) delete process.env.TALE_TEST_BREAK_GLASS_HASH;
      else process.env.TALE_TEST_BREAK_GLASS_HASH = value;
      run.docker.calls = [];
      const error = await run.apply().catch((failure: unknown) => failure);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toContain(message);
      expect(JSON.stringify(error)).not.toContain('synthetic-not-a-hash');
      expect(run.docker.calls).toEqual([]);
      expect(run.events).toEqual([]);
      expect(existsSync(run.fixture.options.stateDirectory)).toBe(false);
    }
  });

  test('refuses a declaration prefix that differs from its verified runtime before destination access', async () => {
    const run = await create();
    const metadata = await verifyDeploymentBundle(run.bundle);
    rmSync(join(run.bundle, 'deployment.json'));
    await writeDeploymentBundle(run.bundle, {
      ...metadata,
      spec: {
        ...run.spec,
        runtime: { ...run.spec.runtime, containerPrefix: 'north-desk-prod' },
      },
    });
    run.docker.calls = [];
    await expect(run.apply()).rejects.toThrow('container prefix');
    expect(run.docker.calls).toEqual([]);
    expect(existsSync(run.fixture.options.stateDirectory)).toBe(false);
  });

  test('declared additional origins reach the runtime while the native identity keeps the primary origin', async () => {
    const run = await create(false, true, ['https://portal.partner.example']);
    const runtime = run.dependencies.runtime!;
    const seen: unknown[] = [];
    run.dependencies.runtime = async (options) => {
      seen.push(options.additionalOrigins);
      return runtime(options);
    };
    const exec = run.dependencies.exec!;
    let provision: Record<string, unknown> = {};
    run.dependencies.exec = async (command, args, options) => {
      if (args.includes('provision'))
        provision = JSON.parse(options?.stdin ?? '{}');
      return exec(command, args, options);
    };
    expect(await run.apply()).toMatchObject({ phase: 'ready' });
    expect(seen).toEqual([
      ['https://portal.partner.example'],
      ['https://portal.partner.example'],
    ]);
    expect(provision.origin).toBe(run.spec.origin);
    expect(JSON.stringify(provision)).not.toContain('portal.partner.example');
    expect(
      parseRuntimeEnvironment(
        readFileSync(
          join(run.fixture.options.stateDirectory, 'src/.env'),
          'utf8',
        ),
        'compose',
      ).ADDITIONAL_SITE_URLS,
    ).toBe('https://portal.partner.example');
  });

  test('declared organization creators reach the runtime environment and stay out of the native identity', async () => {
    const run = await create(false, true, undefined, [
      'ops@example.invalid',
      'sam@example.invalid',
    ]);
    const runtime = run.dependencies.runtime!;
    const seen: unknown[] = [];
    run.dependencies.runtime = async (options) => {
      seen.push(options.organizationCreators);
      return runtime(options);
    };
    const exec = run.dependencies.exec!;
    let provision: Record<string, unknown> = {};
    run.dependencies.exec = async (command, args, options) => {
      if (args.includes('provision'))
        provision = JSON.parse(options?.stdin ?? '{}');
      return exec(command, args, options);
    };
    expect(await run.apply()).toMatchObject({ phase: 'ready' });
    expect(seen).toEqual([
      ['ops@example.invalid', 'sam@example.invalid'],
      ['ops@example.invalid', 'sam@example.invalid'],
    ]);
    expect(JSON.stringify(provision)).not.toContain('sam@example.invalid');
    expect(
      parseRuntimeEnvironment(
        readFileSync(
          join(run.fixture.options.stateDirectory, 'src/.env'),
          'utf8',
        ),
        'compose',
      ).TALE_ORGANIZATION_CREATORS,
    ).toBe('ops@example.invalid,sam@example.invalid');
  });

  test('a deployment without additional origins hands the runtime none', async () => {
    const run = await create();
    const runtime = run.dependencies.runtime!;
    run.dependencies.runtime = async (options) => {
      expect(options).not.toHaveProperty('additionalOrigins');
      return runtime(options);
    };
    await run.apply();
    expect(
      readFileSync(
        join(run.fixture.options.stateDirectory, 'src/.env'),
        'utf8',
      ),
    ).not.toContain('ADDITIONAL_SITE_URLS');
  });

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
    run.spec.identity!.migrateOriginFrom = 'https://old.example.invalid';
    run.spec.identity!.migrateEmailFrom = 'previous-operator@example.invalid';
    run.spec.identity!.breakGlass = {
      email: { env: 'TALE_TEST_BREAK_GLASS_EMAIL' },
      passwordHash: { env: 'TALE_TEST_BREAK_GLASS_HASH' },
    };
    process.env.TALE_TEST_BREAK_GLASS_EMAIL = 'break-glass@example.invalid';
    process.env.TALE_TEST_BREAK_GLASS_HASH = BREAK_GLASS_HASH;
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
    expect(
      readFileSync(join(run.bundle, 'deployment.json'), 'utf8'),
    ).not.toContain(BREAK_GLASS_HASH);
    const privateRoot = `/app/data/ops/tale-deployments/${run.spec.name}/private`;
    const native = {
      ...run.native,
      breakGlass: {
        userId: 'break-glass-user',
        email: 'break-glass@example.invalid',
        created: true,
        credentialUpdated: false,
      },
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
      if (args.includes('provision')) {
        expect(JSON.parse(options?.stdin ?? '{}')).toMatchObject({
          bootstrap: 'fresh',
          migrateOriginFrom: 'https://old.example.invalid',
          migrateEmailFrom: 'previous-operator@example.invalid',
          emailVerification: 'operator-attested',
          breakGlass: {
            email: 'break-glass@example.invalid',
            passwordHash: BREAK_GLASS_HASH,
          },
          nativeClients: [{ managed: true }],
        });
        // The hash reaches the backend only on private stdin.
        expect(args.join(' ')).not.toContain(BREAK_GLASS_HASH);
        expect(JSON.stringify(options?.env)).not.toContain(BREAK_GLASS_HASH);
      }
      return execute(command, args, options);
    };
    for (const changed of [
      { ...native, breakGlass: undefined },
      {
        ...native,
        breakGlass: { ...native.breakGlass, email: 'other@example.invalid' },
      },
      {
        ...native,
        breakGlass: { ...native.breakGlass, userId: run.native.userId },
      },
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
    expect(receipt.native.breakGlass).toEqual(native.breakGlass);
    expect(JSON.stringify(receipt)).not.toContain(BREAK_GLASS_HASH);
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
describePosix('model gateway recovery point', () => {
  const PRE_CAPTURE_SNAPSHOT = '20260910-000000-deploy';
  type Run = Awaited<ReturnType<typeof create>>;
  const pendingPath = (run: Run) =>
    join(run.fixture.options.stateDirectory, '.tale/deployment-pending.json');
  const runtimeReceiptPath = (run: Run) =>
    join(run.fixture.options.stateDirectory, '.tale/runtime.json');
  const gatewayOf = (bundle: string) =>
    readRuntimeBundle(join(bundle, 'runtime')).bundle.images.find((image) =>
      image.services.includes('sandbox-llm-gateway'),
    )!.reference;
  const gatewayContainer = (run: Run) =>
    run.docker.containers.find(
      (container) =>
        (container.Config as { Labels: Record<string, string> }).Labels[
          'com.docker.compose.service'
        ] === 'sandbox-llm-gateway',
    )!;
  /** Prepare a bundle of the next release: the same commit under a release
   * tag whose images the release build made anew, so every Tale image — the
   * gateway's with them — has another digest. */
  async function nextRelease(
    run: Run,
    name: string,
    extra: Record<string, unknown> = {},
  ) {
    if (run.docker.variantTag !== '0.5.17') {
      run.fixture.git('tag', 'v0.5.17');
      run.docker.variantTag = '0.5.17';
    }
    const output = join(run.fixture.directory, name);
    writeFileSync(
      run.preparation.spec,
      JSON.stringify({ ...run.spec, ...extra }),
    );
    await prepareDeployment(
      { ...run.preparation, output },
      run.prepareDependencies,
    );
    writeFileSync(run.preparation.spec, JSON.stringify(run.spec));
    return output;
  }
  const applyBundle = (run: Run, bundle: string) =>
    applyDeployment({ bundle }, run.dependencies);
  /** A rollout that stops at its image pull, before any container changes. */
  async function stopAtPull(run: Run, bundle: string) {
    run.docker.missingTags.add(gatewayOf(bundle));
    await expect(applyBundle(run, bundle)).rejects.toThrow(
      'Docker refused the managed runtime operation.',
    );
    run.docker.missingTags.clear();
  }
  /** The pending receipt as a CLI from before the gateway store was captured
   * wrote it: the same recovery snapshot, without the gateway archive. */
  function asPreCaptureReceipt(run: Run) {
    const intent = JSON.parse(readFileSync(pendingPath(run), 'utf8'));
    delete intent.snapshot.volumes['llm-gateway-data'];
    writeFileSync(pendingPath(run), `${JSON.stringify(intent, null, 2)}\n`);
    return readFileSync(pendingPath(run));
  }
  async function refusal(apply: () => Promise<unknown>): Promise<CliError> {
    const failure = await apply().catch((error: unknown) => error);
    if (!(failure instanceof CliError)) throw failure;
    return failure;
  }
  async function warnings(apply: () => Promise<unknown>) {
    const warned: string[] = [];
    // Read at the logger, not on stdout: the shared reporter drops lines while
    // another suite in the same process has left it silenced (--json mode).
    const warn = spyOn(logger, 'warn').mockImplementation((message) => {
      warned.push(message);
    });
    try {
      return { result: await apply(), warned };
    } finally {
      warn.mockRestore();
    }
  }
  const UNCOVERED = `Recovery snapshot ${PRE_CAPTURE_SNAPSHOT} does not contain llm-gateway-data: restoring it leaves the model gateway's store as it is now.`;
  const ONWARD =
    'While no runtime rollout is pending, a reviewed bundle that still resolves the gateway image the deployment last ran can take it over (`supersedesPendingBundle`), and the rollout after it takes a snapshot that holds the gateway store; otherwise the CLI has no way forward for this state.';
  const NO_RECOVERY_POINT =
    'The pending deployment recorded no recovery snapshot, and none can be taken now: this rollout has no recovery point.';

  // The release stopped at its pull: the store has only run the previous
  // gateway, and its recovery snapshot came from a CLI that left it out.
  test('a release that stopped before its gateway ran is refused on a retained snapshot without the gateway store, with every receipt untouched', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    await stopAtPull(run, release);
    const pending = asPreCaptureReceipt(run);
    const runtimeReceipt = readFileSync(runtimeReceiptPath(run));
    const ready = readFileSync(run.receiptPath);
    run.events.length = 0;
    run.docker.calls = [];

    const error = await refusal(() => applyBundle(run, release));

    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toBe(
      `Recovery snapshot ${PRE_CAPTURE_SNAPSHOT} does not contain llm-gateway-data, and this rollout would start gateway image ${gatewayOf(release)} on tale_llm-gateway-data, and nothing shows the store has run it (its gateway container runs ${gatewayOf(run.bundle)}); a newer gateway migrates that store forward-only.`,
    );
    expect(error.info.next).toBe(
      `Nothing was changed. Do not remove the pending receipt: a snapshot taken now could already hold a migrated store. ${ONWARD}`,
    );
    expect(run.events).toEqual([]);
    expect(
      run.docker.calls.some(
        ({ args }) => args.includes('up') || args[0] === 'pull',
      ),
    ).toBe(false);
    expect(readFileSync(pendingPath(run))).toEqual(pending);
    expect(readFileSync(runtimeReceiptPath(run))).toEqual(runtimeReceipt);
    expect(readFileSync(run.receiptPath)).toEqual(ready);
  });

  test('a superseding bundle that also moves the gateway cannot take over such a snapshot, and the takeover is not recorded', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    await stopAtPull(run, release);
    const pending = asPreCaptureReceipt(run);
    const superseding = await nextRelease(run, 'superseding-deployment', {
      runtime: { ...run.spec.runtime, containerPrefix: 'north-desk-prod' },
      supersedesPendingBundle: JSON.parse(pending.toString()).bundleSha256,
    });
    run.events.length = 0;
    run.docker.calls = [];

    const error = await refusal(() => applyBundle(run, superseding));

    expect(error.message).toContain(
      `Recovery snapshot ${PRE_CAPTURE_SNAPSHOT} does not contain llm-gateway-data`,
    );
    expect(run.events).toEqual([]);
    expect(run.docker.calls.some(({ args }) => args.includes('up'))).toBe(
      false,
    );
    // Byte-identical: still the pending bundle, no superseded list.
    expect(readFileSync(pendingPath(run))).toEqual(pending);
  });

  // The documented way on from that refusal: a bundle that resolves the
  // gateway image the store already runs takes the pending deployment over,
  // and the release after that snapshots the gateway store with the rest.
  test('a bundle on the gateway image the store has run takes over with a warning, and the next release snapshots the gateway store', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    await stopAtPull(run, release);
    const pending = JSON.parse(asPreCaptureReceipt(run).toString());
    // The registry serves the release tag with the bytes the store runs.
    run.docker.variantTag = null;
    const keeping = join(run.fixture.directory, 'keeping-deployment');
    writeFileSync(
      run.preparation.spec,
      JSON.stringify({
        ...run.spec,
        supersedesPendingBundle: pending.bundleSha256,
      }),
    );
    await prepareDeployment(
      { ...run.preparation, output: keeping },
      run.prepareDependencies,
    );
    writeFileSync(run.preparation.spec, JSON.stringify(run.spec));
    expect(gatewayOf(keeping)).toBe(gatewayOf(run.bundle));

    const takeover = await warnings(() => applyBundle(run, keeping));

    expect(takeover.result).toMatchObject({
      phase: 'ready',
      snapshotId: PRE_CAPTURE_SNAPSHOT,
      supersededBundles: [pending.bundleSha256],
    });
    expect(takeover.warned).toContain(UNCOVERED);
    expect(existsSync(pendingPath(run))).toBe(false);
    run.docker.variantTag = '0.5.17';
    const next = await nextRelease(run, 'next-deployment');
    run.events.length = 0;
    const upgrade = await warnings(() => applyBundle(run, next));
    expect(upgrade.result).toMatchObject({
      phase: 'ready',
      runtimeChanged: true,
    });
    expect(run.events.slice(0, 3)).toEqual([
      'snapshot',
      'verify-snapshot',
      'up',
    ]);
    expect(
      upgrade.warned.some((line) => line.includes('llm-gateway-data')),
    ).toBe(false);
  });

  // Past its image checks a rollout is pending, and the runtime admits only
  // that same runtime: the image-keeping takeover is refused there, the
  // retry here. The documented state with no CLI way on.
  test('once a release rollout is pending before its gateway ran, the retry is refused here and an image-keeping takeover by the runtime', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    const db = run.docker.containers.find(
      (container) =>
        (container.Config as { Labels: Record<string, string> }).Labels[
          'com.docker.compose.service'
        ] === 'db',
    )!;
    run.docker.staleHealth.set('db', {
      status: 'unhealthy',
      reads: Number.POSITIVE_INFINITY,
    });
    await expect(applyBundle(run, release)).rejects.toThrow(
      'managed Compose startup',
    );
    run.docker.staleHealth.delete('db');
    (db.State as { Health: { Status: string } }).Health.Status = 'healthy';
    expect(
      JSON.parse(readFileSync(runtimeReceiptPath(run), 'utf8')).phase,
    ).toBe('pending');
    expect(gatewayContainer(run).Config).toMatchObject({
      Image: gatewayOf(run.bundle),
    });
    const pending = asPreCaptureReceipt(run);

    const retry = await refusal(() => applyBundle(run, release));

    expect(retry.message).toContain('nothing shows the store has run it');
    run.docker.variantTag = null;
    const keeping = join(run.fixture.directory, 'keeping-deployment');
    writeFileSync(
      run.preparation.spec,
      JSON.stringify({
        ...run.spec,
        supersedesPendingBundle: JSON.parse(pending.toString()).bundleSha256,
      }),
    );
    await prepareDeployment(
      { ...run.preparation, output: keeping },
      run.prepareDependencies,
    );
    writeFileSync(run.preparation.spec, JSON.stringify(run.spec));
    await expect(applyBundle(run, keeping)).rejects.toThrow(
      'A different runtime operation is pending',
    );
    expect(readFileSync(pendingPath(run))).toEqual(pending);
  });

  // The inventory boundary, in both lanes a retained pre-capture snapshot can
  // be continued in: whatever Docker answers instead of a readable listing,
  // the rollout is refused before any write and every receipt stays as it was.
  const LANES = [
    'a retry of the pending release',
    'a superseding bundle',
  ] as const;
  /** A successful answer: `docker volume ls` printed `stdout`. */
  const listed = (stdout: string) => ({
    success: true,
    exitCode: 0,
    stdout,
    stderr: '',
  });
  const UNREADABLE = [
    [
      'a JSON array of records',
      () => listed('[{"Name":"tale_llm-gateway-data"}]'),
      'Docker volume metadata is incomplete.',
    ],
    [
      'a later record without a name',
      (listing: string) => listed(`${listing}\n{"Driver":"local"}`),
      'Docker volume metadata is incomplete.',
    ],
    [
      'a later line that is not a record',
      (listing: string) => listed(`${listing}\ntale_llm-gateway-data`),
      'Docker returned invalid runtime metadata.',
    ],
    [
      'a transport failure',
      () => ({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'error during connect: unexpected EOF',
      }),
      'Docker refused the managed runtime operation.',
    ],
    [
      'a permission failure',
      () => ({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr:
          'permission denied while trying to connect to the Docker daemon socket',
      }),
      'Docker refused the managed runtime operation.',
    ],
    [
      'a Docker call that throws',
      () => {
        throw new Error('spawn docker EACCES');
      },
      'Docker could not complete the managed runtime operation.',
    ],
  ] as const;
  /** Volumes a plugin keeps, named as no local volume can be. */
  const PLUGIN_VOLUMES = ['foreign/plugin-data', 'x'];
  /** A pending pre-capture receipt for the next release, stopped at its pull,
   * and the bundle the lane continues it with. */
  async function pendingPreCapture(run: Run, lane: (typeof LANES)[number]) {
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    await stopAtPull(run, release);
    const pending = asPreCaptureReceipt(run);
    const bundle =
      lane === 'a retry of the pending release'
        ? release
        : await nextRelease(run, 'superseding-deployment', {
            runtime: {
              ...run.spec.runtime,
              containerPrefix: 'north-desk-prod',
            },
            supersedesPendingBundle: JSON.parse(pending.toString())
              .bundleSha256,
          });
    return { bundle, pending };
  }
  const receipts = (run: Run) => ({
    pending: readFileSync(pendingPath(run)),
    runtime: readFileSync(runtimeReceiptPath(run)),
    ready: readFileSync(run.receiptPath),
  });
  /** Whether Docker was asked to change the runtime. */
  const changedRuntime = (run: Run) =>
    run.docker.calls.some(
      ({ args }) =>
        ['pull', 'tag', 'restart'].includes(args[0]) ||
        (args[0] === 'network' && args[1] === 'create') ||
        args.includes('up'),
    );

  describe.each([...LANES])('at the volume inventory, for %s', (lane) => {
    test.each(UNREADABLE)(
      '%s refuses before any write, with every receipt byte-identical',
      async (_name, answer, message) => {
        const run = await create();
        const { bundle } = await pendingPreCapture(run, lane);
        const before = receipts(run);
        run.docker.volumeListing = answer;
        run.events.length = 0;
        run.docker.calls = [];

        await expect(applyBundle(run, bundle)).rejects.toThrow(message);

        expect(run.events).toEqual([]);
        expect(changedRuntime(run)).toBe(false);
        expect(receipts(run)).toEqual(before);
      },
    );

    test('a listing with plugin and foreign volumes and the gateway volume refuses at the gateway check', async () => {
      const run = await create();
      const { bundle } = await pendingPreCapture(run, lane);
      run.docker.pluginVolumes.push(...PLUGIN_VOLUMES);
      run.docker.volumes.push('other-project_llm-gateway-data', 'a'.repeat(64));
      const before = receipts(run);
      run.events.length = 0;
      run.docker.calls = [];

      const error = await refusal(() => applyBundle(run, bundle));

      expect(error.message).toContain(
        `Recovery snapshot ${PRE_CAPTURE_SNAPSHOT} does not contain llm-gateway-data`,
      );
      expect(run.events).toEqual([]);
      expect(changedRuntime(run)).toBe(false);
      expect(receipts(run)).toEqual(before);
    });

    test.each([
      [
        'plugin and foreign volumes',
        (run: Run) => {
          run.docker.pluginVolumes.push(...PLUGIN_VOLUMES);
          run.docker.volumes.push('other-project_llm-gateway-data');
        },
      ],
      [
        'no volumes at all',
        (run: Run) => {
          run.docker.volumes = [];
        },
      ],
    ])(
      'a listing of %s without the gateway volume, its gateway gone, continues',
      async (_name, arrange) => {
        const run = await create();
        const { bundle } = await pendingPreCapture(run, lane);
        run.docker.containers = run.docker.containers.filter(
          (container) => container !== gatewayContainer(run),
        );
        run.docker.volumes = run.docker.volumes.filter(
          (volume) => volume !== 'tale_llm-gateway-data',
        );
        arrange(run);

        expect(await applyBundle(run, bundle)).toMatchObject({
          phase: 'ready',
          snapshotId: PRE_CAPTURE_SNAPSHOT,
        });
      },
    );
  });

  // A stopped container on the target image counts as the store having run it
  // only by a start time in Moby's contract after the Unix epoch, fraction
  // included.
  test.each([
    ['1', false],
    ['not-a-timestamp', false],
    ['2026-09-30T08:01:07.123456789Z', true],
    ['1970-01-01T00:00:00.001Z', true],
    ['1970-01-01T01:00:00.001+01:00', true],
  ] as const)(
    'a stopped release gateway whose start time reads %p: the store has run it: %p',
    async (startedAt, ran) => {
      const run = await create();
      await run.apply();
      const release = await nextRelease(run, 'release-deployment');
      run.docker.upFailure = true;
      await expect(applyBundle(run, release)).rejects.toThrow(
        'could not complete',
      );
      run.docker.upFailure = false;
      asPreCaptureReceipt(run);
      Object.assign(gatewayContainer(run).State as object, {
        Running: false,
        StartedAt: startedAt,
      });
      const before = receipts(run);
      run.events.length = 0;
      run.docker.calls = [];

      if (ran) {
        const { result, warned } = await warnings(() =>
          applyBundle(run, release),
        );
        expect(result).toMatchObject({ phase: 'ready' });
        expect(warned).toContain(UNCOVERED);
        return;
      }
      const error = await refusal(() => applyBundle(run, release));
      expect(error.message).toContain('nothing shows the store has run it');
      expect(run.events).toEqual([]);
      expect(changedRuntime(run)).toBe(false);
      expect(receipts(run)).toEqual(before);
    },
  );

  // Nothing a refusal could protect is left: the interrupted rollout already
  // started the new gateway on the store. It completes, and says so.
  test('a release whose new gateway already started completes on its retained snapshot and says the snapshot leaves the gateway store out', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    run.docker.upFailure = true;
    await expect(applyBundle(run, release)).rejects.toThrow(
      'could not complete',
    );
    run.docker.upFailure = false;
    asPreCaptureReceipt(run);
    expect(gatewayContainer(run).Config).toMatchObject({
      Image: gatewayOf(release),
    });
    expect(gatewayOf(release)).not.toBe(gatewayOf(run.bundle));
    run.events.length = 0;

    const { result, warned } = await warnings(() => applyBundle(run, release));

    expect(result).toMatchObject({
      phase: 'ready',
      runtimeChanged: true,
      snapshotId: PRE_CAPTURE_SNAPSHOT,
    });
    expect(warned).toContain(UNCOVERED);
  });

  test('a retry after the release runtime became ready completes with the gateway container gone, since the store has run its image', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    run.nativeFailure(true);
    await expect(applyBundle(run, release)).rejects.toThrow(
      'did not complete provisioning',
    );
    run.nativeFailure(false);
    asPreCaptureReceipt(run);
    // Removed after the runtime became ready: only its receipt says the store
    // has run the release gateway.
    run.docker.containers = run.docker.containers.filter(
      (container) => container !== gatewayContainer(run),
    );
    run.events.length = 0;

    const { result, warned } = await warnings(() => applyBundle(run, release));

    expect(result).toMatchObject({
      phase: 'ready',
      snapshotId: PRE_CAPTURE_SNAPSHOT,
    });
    expect(warned).toContain(UNCOVERED);
  });

  // A re-run of a ready bundle that changes nothing records no snapshot at
  // all; the stack is still that ready state, so a takeover snapshots it first
  // and keeps that snapshot with the pending deployment before it rolls out.
  test('a pending receipt that recorded no snapshot takes one before a takeover changes the runtime, and keeps it through an interruption', async () => {
    const run = await create();
    await run.apply();
    run.nativeFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    run.nativeFailure(false);
    const pending = JSON.parse(readFileSync(pendingPath(run), 'utf8'));
    expect(pending).not.toHaveProperty('snapshot');
    const superseding = await nextRelease(run, 'superseding-deployment', {
      supersedesPendingBundle: pending.bundleSha256,
    });
    run.events.length = 0;
    await stopAtPull(run, superseding);
    expect(run.events).toEqual(['snapshot', 'verify-snapshot']);
    expect(JSON.parse(readFileSync(pendingPath(run), 'utf8'))).toMatchObject({
      snapshot: { id: PRE_CAPTURE_SNAPSHOT },
      supersededBundles: [pending.bundleSha256],
    });
    run.events.length = 0;

    const result = await applyBundle(run, superseding);

    expect(run.events.slice(0, 2)).toEqual(['verify-snapshot', 'up']);
    expect(result).toMatchObject({
      phase: 'ready',
      snapshotId: PRE_CAPTURE_SNAPSHOT,
      supersededBundles: [pending.bundleSha256],
      runtimeChanged: true,
    });
  });

  test('a same-bundle retry of such a receipt whose runtime drifted snapshots once and keeps that snapshot', async () => {
    const run = await create();
    await run.apply();
    run.nativeFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    run.nativeFailure(false);
    expect(
      JSON.parse(readFileSync(pendingPath(run), 'utf8')),
    ).not.toHaveProperty('snapshot');
    // The proxy container is gone: the retry changes the runtime again.
    run.docker.containers = run.docker.containers.filter(
      (container) =>
        (container.Config as { Labels: Record<string, string> }).Labels[
          'com.docker.compose.service'
        ] !== 'proxy',
    );
    run.events.length = 0;
    await stopAtPull(run, run.bundle);
    expect(run.events).toEqual(['snapshot', 'verify-snapshot']);
    expect(JSON.parse(readFileSync(pendingPath(run), 'utf8'))).toMatchObject({
      snapshot: { id: PRE_CAPTURE_SNAPSHOT },
    });
    run.events.length = 0;

    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      snapshotId: PRE_CAPTURE_SNAPSHOT,
    });
    expect(run.events).toEqual([
      'verify-snapshot',
      'up',
      'provision',
      'cleanup',
    ]);
  });

  /** A pending receipt as an older CLI's snapshot-less takeover left it:
   * another bundle, the superseded one listed, and still no snapshot. */
  async function olderTakeoverReceipt(run: Run) {
    await run.apply();
    run.nativeFailure(true);
    await expect(run.apply()).rejects.toThrow('did not complete provisioning');
    run.nativeFailure(false);
    const intent = JSON.parse(readFileSync(pendingPath(run), 'utf8'));
    intent.supersededBundles = [intent.bundleSha256];
    intent.bundleSha256 = 'f'.repeat(64);
    writeFileSync(pendingPath(run), `${JSON.stringify(intent, null, 2)}\n`);
    return readFileSync(pendingPath(run));
  }

  // One an older CLI took over without a snapshot may carry a partial rollout.
  test('a pending receipt taken over before without a snapshot refuses a release onto a gateway image the store has not run', async () => {
    const run = await create();
    const pending = await olderTakeoverReceipt(run);
    const superseding = await nextRelease(run, 'superseding-deployment', {
      supersedesPendingBundle: 'f'.repeat(64),
    });
    run.events.length = 0;
    run.docker.calls = [];

    const error = await refusal(() => applyBundle(run, superseding));

    expect(error.message).toBe(
      `The pending deployment recorded no recovery snapshot, and this rollout would start gateway image ${gatewayOf(superseding)} on tale_llm-gateway-data, and nothing shows the store has run it (its gateway container runs ${gatewayOf(run.bundle)}); a newer gateway migrates that store forward-only.`,
    );
    expect(error.info.next).toBe(
      `Nothing was changed and the pending receipt is kept: its earlier takeover may already have changed the stack, so a snapshot taken now cannot stand in for the missing one. ${ONWARD} That takeover has no recovery point either.`,
    );
    expect(run.events).toEqual([]);
    expect(run.docker.calls.some(({ args }) => args.includes('up'))).toBe(
      false,
    );
    expect(readFileSync(pendingPath(run))).toEqual(pending);
  });

  test('a takeover of such a receipt that keeps the gateway image proceeds, and says it has no recovery point', async () => {
    const run = await create();
    await olderTakeoverReceipt(run);
    const keeping = join(run.fixture.directory, 'keeping-deployment');
    writeFileSync(
      run.preparation.spec,
      JSON.stringify({
        ...run.spec,
        runtime: { ...run.spec.runtime, containerPrefix: 'north-desk-prod' },
        supersedesPendingBundle: 'f'.repeat(64),
      }),
    );
    await prepareDeployment(
      { ...run.preparation, output: keeping },
      run.prepareDependencies,
    );
    writeFileSync(run.preparation.spec, JSON.stringify(run.spec));
    expect(gatewayOf(keeping)).toBe(gatewayOf(run.bundle));
    const notices: string[] = [];
    const notice = spyOn(logger, 'notice').mockImplementation((message) => {
      notices.push(message);
    });
    let outcome: Awaited<ReturnType<typeof warnings>>;
    try {
      outcome = await warnings(() => applyBundle(run, keeping));
    } finally {
      notice.mockRestore();
    }

    expect(outcome.result).toMatchObject({ phase: 'ready' });
    expect(
      (outcome.result as { snapshotId?: string }).snapshotId,
    ).toBeUndefined();
    expect(outcome.warned).toContain(NO_RECOVERY_POINT);
    expect(notices).toContain(
      `Superseding the pending deployment bundle ${'f'.repeat(64)}; it recorded no recovery snapshot.`,
    );
    expect(notices.some((line) => line.includes('is kept'))).toBe(false);
  });

  // The snapshot helper captures the volume whenever `docker volume inspect`
  // finds it; the runtime's own volume listing is checked again here.
  test('a new snapshot that leaves out a present gateway volume is refused before any pending receipt or rollout', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    run.snapshotWithoutGateway(true);
    run.events.length = 0;
    run.docker.calls = [];

    const error = await refusal(() => applyBundle(run, release));

    expect(error.message).toContain(
      `Recovery snapshot ${PRE_CAPTURE_SNAPSHOT} does not contain llm-gateway-data`,
    );
    expect(error.info.next).toBe(
      'The runtime was not touched and no pending deployment was recorded; retry to take the snapshot again.',
    );
    expect(run.events).toEqual(['snapshot']);
    expect(existsSync(pendingPath(run))).toBe(false);
    expect(run.docker.calls.some(({ args }) => args.includes('up'))).toBe(
      false,
    );
    run.snapshotWithoutGateway(false);
    run.events.length = 0;
    expect(await applyBundle(run, release)).toMatchObject({ phase: 'ready' });
    expect(run.events).toEqual([
      'snapshot',
      'verify-snapshot',
      'up',
      'provision',
      'cleanup',
    ]);
  });

  test('a deployment whose gateway and its volume are gone keeps its retained snapshot and continues', async () => {
    const run = await create();
    await run.apply();
    const release = await nextRelease(run, 'release-deployment');
    await stopAtPull(run, release);
    asPreCaptureReceipt(run);
    run.docker.containers = run.docker.containers.filter(
      (container) => container !== gatewayContainer(run),
    );
    run.docker.volumes = run.docker.volumes.filter(
      (volume) => volume !== 'tale_llm-gateway-data',
    );
    run.events.length = 0;

    expect(await applyBundle(run, release)).toMatchObject({
      phase: 'ready',
      runtimeChanged: true,
      snapshotId: PRE_CAPTURE_SNAPSHOT,
    });
    expect(run.events).toEqual([
      'verify-snapshot',
      'up',
      'provision',
      'cleanup',
    ]);
  });

  // A fresh installation records no recovery snapshot: there was nothing to
  // protect, and its own gateway volume is the one the rollout created.
  test('a fresh installation retries its rollout as before', async () => {
    const run = await create();
    run.docker.upFailure = true;
    await expect(run.apply()).rejects.toThrow('could not complete');
    expect(
      JSON.parse(readFileSync(pendingPath(run), 'utf8')),
    ).not.toHaveProperty('snapshot');
    expect(run.docker.volumes).toContain('tale_llm-gateway-data');
    // Compose made the volumes and died before the gateway ran.
    Object.assign(gatewayContainer(run).State as object, {
      Running: false,
      StartedAt: '0001-01-01T00:00:00Z',
    });
    run.docker.upFailure = false;

    expect(await run.apply()).toMatchObject({
      phase: 'ready',
      runtimeChanged: true,
    });
  });
});

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

describePosix('configuration-only managed deployment', () => {
  async function hotBundle(
    run: Awaited<ReturnType<typeof create>>,
    identityDrift = false,
  ) {
    const directory = join(run.fixture.directory, 'hot-configuration');
    const configuration = {
      schemaVersion: 1,
      resources: [
        {
          kind: 'project-instructions',
          config: {
            projectId: 'native-project',
            instructions: 'Reviewed policy',
          },
        },
      ],
    };
    writeFileSync(
      run.preparation.spec,
      JSON.stringify({
        ...run.spec,
        ...(identityDrift
          ? { identity: { ...run.spec.identity, name: 'Changed identity' } }
          : {}),
        configuration,
      }),
    );
    await prepareDeployment(
      { ...run.preparation, output: directory },
      run.prepareDependencies,
    );
    const proof = {
      configured: true,
      configurationSha256: valueHash(configuration),
      deploymentBundleSha256: sha256(
        readFileSync(join(directory, 'deployment.json')),
      ),
      target: {
        origin: run.spec.origin,
        organizationId: run.native.organizationId,
        organizationSlug: run.native.organizationSlug,
      },
      resources: [
        {
          id: 'project-instructions/native-project',
          configurationSha256: valueHash(configuration.resources[0]!.config),
          revision: 'a'.repeat(64),
        },
      ],
      unchanged: false,
      restartRequired: false,
    };
    run.nativeOutput(() =>
      JSON.stringify({
        ok: true,
        command: 'deploy provision',
        data: { ...run.native, nativeClients: [], configuration: proof },
      }),
    );
    return { directory, proof };
  }

  test('a dry run verifies runtime admission without native or receipt writes', async () => {
    const run = await create();
    await run.apply();
    const ready = readFileSync(run.receiptPath);
    const hot = await hotBundle(run);
    run.events.length = 0;
    expect(
      await applyDeployment(
        { bundle: hot.directory, configurationOnly: true, dryRun: true },
        run.dependencies,
      ),
    ).toMatchObject({ dryRun: true, configurationOnly: true });
    expect(run.events).toEqual([]);
    expect(readFileSync(run.receiptPath)).toEqual(ready);
    expect(
      existsSync(
        join(
          run.fixture.options.stateDirectory,
          '.tale/configuration-ready.json',
        ),
      ),
    ).toBe(false);
  });

  test.each([
    'user',
    'organization',
    'client',
    'restart',
    'post-runtime',
  ] as const)(
    'refuses %s proof drift after native work without certifying the apply',
    async (reason) => {
      const run = await create();
      await run.apply();
      const ready = readFileSync(run.receiptPath);
      const hot = await hotBundle(run);
      run.nativeOutput(() => {
        if (reason === 'post-runtime') {
          run.docker.containers.find(
            (container) =>
              (container.Config as { Labels: Record<string, string> }).Labels[
                'com.docker.compose.service'
              ] === 'backend-api',
          )!.Id = 'replaced-backend-container';
        }
        return JSON.stringify({
          ok: true,
          command: 'deploy provision',
          data: {
            ...run.native,
            userId: reason === 'user' ? 'foreign-user' : run.native.userId,
            organizationId:
              reason === 'organization'
                ? 'foreign-org'
                : run.native.organizationId,
            nativeClients: reason === 'client' ? run.native.nativeClients : [],
            configuration: {
              ...hot.proof,
              restartRequired: reason === 'restart',
            },
          },
        });
      });
      run.events.length = 0;
      await expect(
        applyDeployment(
          { bundle: hot.directory, configurationOnly: true },
          run.dependencies,
        ),
      ).rejects.toThrow();
      expect(run.events).toEqual(['provision', 'cleanup']);
      expect(readFileSync(run.receiptPath)).toEqual(ready);
      expect(
        existsSync(
          join(
            run.fixture.options.stateDirectory,
            '.tale/configuration-ready.json',
          ),
        ),
      ).toBe(false);
    },
  );

  test('changes hot native configuration without snapshot, Compose or full Ready replacement', async () => {
    const run = await create();
    await run.apply();
    const ready = readFileSync(run.receiptPath);
    const beforeIds = run.docker.containers.map((container) => container.Id);
    const hot = await hotBundle(run);
    run.events.length = 0;
    run.docker.calls = [];
    const result = await applyDeployment(
      { bundle: hot.directory, configurationOnly: true },
      run.dependencies,
    );
    expect(result).toMatchObject({
      phase: 'configuration-ready',
      runtimeChanged: false,
      native: { configuration: hot.proof },
    });
    expect(run.events).toEqual(['provision', 'cleanup']);
    expect(run.nativeCommands.at(-1)).toContain('--configuration-only');
    expect(run.nativeCommands.at(-1)).toEqual(
      expect.arrayContaining([
        '--expected-user',
        run.native.userId,
        '--expected-organization',
        run.native.organizationId,
      ]),
    );
    expect(readFileSync(run.receiptPath)).toEqual(ready);
    expect(run.docker.containers.map((container) => container.Id)).toEqual(
      beforeIds,
    );
    expect(
      run.docker.calls.some(
        (call) =>
          call.args.includes('compose') ||
          call.args.includes('pause') ||
          call.args.includes('pull'),
      ),
    ).toBe(false);
    const receipt = join(
      run.fixture.options.stateDirectory,
      '.tale/configuration-ready.json',
    );
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({
      phase: 'configuration-ready',
      baseDeploymentBundleSha256: JSON.parse(ready.toString()).bundleSha256,
    });
    expect(
      existsSync(
        join(
          run.fixture.options.stateDirectory,
          '.tale/deployment-pending.json',
        ),
      ),
    ).toBe(false);
  });

  test('refuses a fresh destination before native writes or recovery snapshots', async () => {
    const run = await create();
    const hot = await hotBundle(run);
    run.events.length = 0;
    await expect(
      applyDeployment(
        { bundle: hot.directory, configurationOnly: true },
        run.dependencies,
      ),
    ).rejects.toThrow('already-ready');
    expect(run.events).toEqual([]);
    expect(existsSync(run.receiptPath)).toBe(false);
  });

  test.each(['old-ready', 'pending', 'identity', 'runtime'] as const)(
    'refuses %s drift without side effects',
    async (reason) => {
      const run = await create();
      await run.apply();
      const hot = await hotBundle(run, reason === 'identity');
      if (reason === 'old-ready') {
        const ready = JSON.parse(readFileSync(run.receiptPath, 'utf8'));
        delete ready.configurationBasisSha256;
        writeFileSync(run.receiptPath, JSON.stringify(ready));
      } else if (reason === 'pending') {
        writeFileSync(
          join(
            run.fixture.options.stateDirectory,
            '.tale/deployment-pending.json',
          ),
          JSON.stringify({
            schemaVersion: 1,
            phase: 'pending',
            name: run.spec.name,
            bundleSha256: hot.proof.deploymentBundleSha256,
          }),
        );
      } else if (reason === 'runtime') {
        const backend = run.docker.containers.find(
          (container) =>
            (container.Config as { Labels: Record<string, string> }).Labels[
              'com.docker.compose.service'
            ] === 'backend-api',
        )!;
        (backend.State as { Running: boolean }).Running = false;
      }
      run.events.length = 0;
      await expect(
        applyDeployment(
          { bundle: hot.directory, configurationOnly: true },
          run.dependencies,
        ),
      ).rejects.toThrow();
      expect(run.events).toEqual([]);
    },
  );

  test('a failed native apply preserves full Ready and does not invent a configuration receipt', async () => {
    const run = await create();
    await run.apply();
    const ready = readFileSync(run.receiptPath);
    const hot = await hotBundle(run);
    run.nativeFailure(true);
    run.events.length = 0;
    await expect(
      applyDeployment(
        { bundle: hot.directory, configurationOnly: true },
        run.dependencies,
      ),
    ).rejects.toThrow('did not complete');
    expect(run.events).toEqual(['provision', 'cleanup']);
    expect(readFileSync(run.receiptPath)).toEqual(ready);
    expect(
      existsSync(
        join(
          run.fixture.options.stateDirectory,
          '.tale/configuration-ready.json',
        ),
      ),
    ).toBe(false);
    run.nativeFailure(false);
    expect(
      await applyDeployment(
        { bundle: hot.directory, configurationOnly: true },
        run.dependencies,
      ),
    ).toMatchObject({ phase: 'configuration-ready' });
  });
});
