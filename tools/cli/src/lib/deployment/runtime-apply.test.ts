import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { BACKUP_VOLUME } from '../backup/constants';
import { applyRuntime } from './runtime-apply';
import { parseRuntimeEnvironment } from './runtime-env';
import { hash } from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import {
  commitRepositorySource,
  installLegacy,
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// Tests here build the git runtime fixture (four git spawns per build);
// Windows CI runners stall on git for seconds at a time, and the 5 s
// default killed a passing test mid-commit.
setDefaultTimeout(30_000);

const describePosix = describe.skipIf(process.platform === 'win32');

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});
async function create(legacy = false, repositorySource = false) {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  if (repositorySource) commitRepositorySource(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  const prior = legacy ? installLegacy(fixture, docker) : null;
  docker.calls = [];
  const apply = (dryRun = false) =>
    applyRuntime({ ...fixture.options, dryRun }, docker.dependencies());
  const receipt = () =>
    JSON.parse(
      readFileSync(
        join(fixture.options.stateDirectory, '.tale/runtime.json'),
        'utf8',
      ),
    );
  return { fixture, docker, prior, apply, receipt };
}
function mutations(docker: RuntimeDockerFixture) {
  return docker.calls.filter(
    ({ args }) =>
      args[0] === 'pull' ||
      args[0] === 'tag' ||
      (args[0] === 'network' && args[1] === 'create') ||
      (args[0] === 'compose' && args.includes('up')),
  );
}

function gatewayOf(docker: RuntimeDockerFixture) {
  return docker.containers.find(
    (container) =>
      (container.Config as { Labels: Record<string, string> }).Labels[
        'com.docker.compose.service'
      ] === 'sandbox-llm-gateway',
  )!;
}

// The managed CLI refuses NTFS: runtime custody includes POSIX file modes.
describePosix('managed source-Compose runtime adoption', () => {
  test('renames visible containers through an interrupted managed rollout without moving storage or regenerating credentials', async () => {
    const { fixture, docker, apply, receipt } = await create(true);
    await apply();
    const original = receipt();
    const volumes = [...docker.volumes];
    const secrets = readFileSync(
      join(fixture.options.stateDirectory, 'secrets.env'),
    );
    const oldBundle = fixture.options.bundleDirectory;
    fixture.options.bundleDirectory = join(fixture.directory, 'prefixed');
    await prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
        containerPrefix: 'north-desk-prod',
      },
      docker.dependencies(),
    );
    expect(await apply(true)).toMatchObject({ existing: true, changed: true });
    expect(receipt()).toEqual(original);
    docker.upFailure = true;
    await expect(apply()).rejects.toThrow('could not complete');
    expect(receipt()).toMatchObject({
      phase: 'pending',
      name: original.name,
      stateDirectory: original.stateDirectory,
      composeProject: original.composeProject,
    });
    docker.upFailure = false;
    docker.calls = [];
    await expect(
      applyRuntime(
        { ...fixture.options, bundleDirectory: oldBundle },
        docker.dependencies(),
      ),
    ).rejects.toThrow('different runtime operation');
    expect(mutations(docker)).toEqual([]);
    expect(await apply()).toMatchObject({
      changed: true,
      regeneratedSecrets: [],
    });
    expect(
      docker.containers.every((container) =>
        String(container.Name).startsWith('/north-desk-prod-'),
      ),
    ).toBe(true);
    expect(docker.volumes).toEqual(volumes);
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'secrets.env')),
    ).toEqual(secrets);
    expect(receipt()).toMatchObject({
      phase: 'ready',
      name: original.name,
      stateDirectory: original.stateDirectory,
      composeProject: original.composeProject,
    });
    docker.calls = [];
    expect(await apply()).toMatchObject({
      changed: false,
      regeneratedSecrets: [],
    });
    expect(mutations(docker)).toEqual([]);
    fixture.options.bundleDirectory = oldBundle;
    expect(await apply()).toMatchObject({
      changed: true,
      regeneratedSecrets: [],
    });
    expect(docker.volumes).toEqual(volumes);
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'secrets.env')),
    ).toEqual(secrets);
    expect(docker.containers[0].Name).toBe('/tale-db');
  });

  test('refuses a prefixed name belonging to another deployment before runtime writes', async () => {
    const { fixture, docker, apply } = await create();
    fixture.options.bundleDirectory = join(fixture.directory, 'prefixed');
    await prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
        containerPrefix: 'north-desk-prod',
      },
      docker.dependencies(),
    );
    docker.foreignNames = ['north-desk-prod-db'];
    docker.calls = [];
    await expect(apply()).rejects.toThrow('belongs to another deployment');
    expect(mutations(docker)).toEqual([]);
    expect(existsSync(fixture.options.stateDirectory)).toBe(false);
  });

  test('does not record readiness until the requested container names are observed', async () => {
    const { fixture, docker, apply, receipt } = await create();
    fixture.options.bundleDirectory = join(fixture.directory, 'prefixed');
    await prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
        containerPrefix: 'north-desk-prod',
      },
      docker.dependencies(),
    );
    docker.onUp = () => {
      docker.containers[0].Name = '/unexpected-db';
    };
    await expect(apply()).rejects.toThrow('did not become healthy');
    expect(receipt().phase).toBe('pending');
    docker.onUp = null;
    await apply();
    expect(receipt().phase).toBe('ready');
  });

  test('additional origins join the receipt input only when declared, and removing them rolls the variable back', async () => {
    const { fixture, docker, apply, receipt } = await create(true);
    // The input shape every receipt recorded before additional origins existed.
    const input = (extra: Record<string, unknown>) =>
      hash(
        JSON.stringify({
          stateDirectory: fixture.options.stateDirectory,
          composeProject: fixture.options.composeProject,
          name: fixture.options.name,
          origin: fixture.options.origin,
          ...extra,
          tlsMode: fixture.options.tlsMode,
          tlsEmail: '',
          environment: [],
        }),
      );
    const env = () =>
      parseRuntimeEnvironment(
        readFileSync(join(fixture.options.stateDirectory, 'src/.env'), 'utf8'),
        'compose',
      );
    await apply();
    expect(receipt().inputSha256).toBe(input({}));
    expect(env().ADDITIONAL_SITE_URLS).toBeUndefined();
    const declared = {
      ...fixture.options,
      additionalOrigins: [
        'https://desk.partner.example',
        'https://old.native.example',
      ],
    };
    expect(await applyRuntime(declared, docker.dependencies())).toMatchObject({
      changed: true,
      regeneratedSecrets: [],
    });
    expect(receipt()).toMatchObject({
      phase: 'ready',
      inputSha256: input({ additionalOrigins: declared.additionalOrigins }),
    });
    expect(env().ADDITIONAL_SITE_URLS).toBe(
      'https://desk.partner.example,https://old.native.example',
    );
    docker.calls = [];
    expect(await applyRuntime(declared, docker.dependencies())).toMatchObject({
      changed: false,
    });
    expect(mutations(docker)).toEqual([]);
    expect(await apply()).toMatchObject({
      changed: true,
      regeneratedSecrets: [],
    });
    expect(receipt().inputSha256).toBe(input({}));
    expect(env().ADDITIONAL_SITE_URLS).toBeUndefined();
  });

  test('refuses invalid additional origins before any Docker call', async () => {
    const { fixture, docker } = await create();
    for (const additionalOrigins of [
      [],
      [fixture.options.origin],
      ['https://desk.partner.example', 'https://desk.partner.example'],
      ['https://desk.partner.example:8443'],
    ]) {
      docker.calls = [];
      await expect(
        applyRuntime(
          { ...fixture.options, additionalOrigins },
          docker.dependencies(),
        ),
      ).rejects.toThrow('additional origins');
      expect(docker.calls).toEqual([]);
    }
    await expect(
      applyRuntime(
        {
          ...fixture.options,
          tlsMode: 'letsencrypt',
          tlsEmail: 'ops@native.example.invalid',
          additionalOrigins: ['https://desk.local'],
        },
        docker.dependencies(),
      ),
    ).rejects.toThrow('additional origins');
  });

  test('adopts an unmanaged stack only for the additional origins its environment already serves', async () => {
    const { fixture, docker, receipt } = await create(true);
    const envPath = join(fixture.options.stateDirectory, 'src/.env');
    writeFileSync(
      envPath,
      `${readFileSync(envPath, 'utf8')}ADDITIONAL_SITE_URLS=https://desk.partner.example\n`,
    );
    for (const additionalOrigins of [
      undefined,
      ['https://other.partner.example'],
    ]) {
      docker.calls = [];
      await expect(
        applyRuntime(
          {
            ...fixture.options,
            ...(additionalOrigins ? { additionalOrigins } : {}),
          },
          docker.dependencies(),
        ),
      ).rejects.toThrow('origin or TLS identity differs');
      expect(mutations(docker)).toEqual([]);
    }
    expect(
      await applyRuntime(
        {
          ...fixture.options,
          additionalOrigins: ['https://desk.partner.example'],
        },
        docker.dependencies(),
      ),
    ).toMatchObject({ existing: true, changed: true });
    expect(receipt().phase).toBe('ready');
  });

  // What a pinned deploy of this release runs: the release's own compose.yml
  // and proxy Caddyfile through this CLI's prepare, read and apply.
  test("applies the repository's own runtime source on a fresh host", async () => {
    const { apply, receipt } = await create(false, true);
    expect(await apply()).toMatchObject({ existing: false, changed: true });
    expect(receipt().phase).toBe('ready');
  });

  test.each(['legacy', 'pending', 'ready'] as const)(
    'refuses a missing mount of an existing volume during %s admission before mutation',
    async (phase) => {
      const run = await create(true);
      if (phase === 'pending') {
        run.docker.upFailure = true;
        await expect(run.apply()).rejects.toThrow('could not complete');
        run.docker.upFailure = false;
      } else if (phase === 'ready') {
        await run.apply();
      }
      const platform = run.docker.containers.find(
        (container) =>
          (container.Config as { Labels: Record<string, string> }).Labels[
            'com.docker.compose.service'
          ] === 'platform',
      ) as { Mounts: { Name: string }[] };
      expect(run.docker.volumes).toContain('tale_config-data');
      platform.Mounts = platform.Mounts.filter(
        (mount) => mount.Name !== 'tale_config-data',
      );
      const volumes = [...run.docker.volumes];
      const containers = structuredClone(run.docker.containers);
      const envPath = join(run.fixture.options.stateDirectory, 'src/.env');
      const secretsPath = join(
        run.fixture.options.stateDirectory,
        'secrets.env',
      );
      const environment = readFileSync(envPath);
      const secrets = readFileSync(secretsPath);
      const receiptPath = join(
        run.fixture.options.stateDirectory,
        '.tale/runtime.json',
      );
      const receipt = existsSync(receiptPath)
        ? readFileSync(receiptPath)
        : null;
      run.docker.calls = [];

      await expect(run.apply(true)).rejects.toThrow(
        'Existing runtime mounts differ',
      );
      await expect(run.apply()).rejects.toThrow(
        'Existing runtime mounts differ',
      );
      expect(mutations(run.docker)).toEqual([]);
      expect(run.docker.volumes).toEqual(volumes);
      expect(run.docker.containers).toEqual(containers);
      expect(readFileSync(envPath)).toEqual(environment);
      expect(readFileSync(secretsPath)).toEqual(secrets);
      expect(
        existsSync(receiptPath) ? readFileSync(receiptPath) : null,
      ).toEqual(receipt);
    },
  );

  test('adopts a release that adds a new named volume to an existing runtime', async () => {
    const run = await create(true);
    const originalVolumes = [...run.docker.volumes];
    const originalMounts = run.docker.containers.map((container) => ({
      name: container.Name,
      mounts: structuredClone(container.Mounts) as { Name: string }[],
    }));
    run.fixture.source.volumes['static-assets'] = {};
    run.fixture.source.services.platform.volumes = [
      ...(run.fixture.source.services.platform.volumes as string[]),
      'static-assets:/app/static-assets',
    ];
    writeFileSync(
      join(run.fixture.repoRoot, 'compose.yml'),
      JSON.stringify(run.fixture.source),
    );
    run.fixture.git('add', 'compose.yml');
    run.fixture.git('commit', '-qm', 'add a managed runtime volume');
    run.fixture.revision = run.fixture.git('rev-parse', 'HEAD');
    const nextBundle = join(run.fixture.directory, 'next-bundle');
    await prepareRuntime(
      {
        repoRoot: run.fixture.repoRoot,
        revision: run.fixture.revision,
        output: nextBundle,
        platform: 'linux/amd64',
      },
      run.docker.dependencies(),
    );
    run.fixture.options.bundleDirectory = nextBundle;
    run.docker.calls = [];

    expect(await run.apply()).toMatchObject({ existing: true, changed: true });
    expect(run.docker.volumes).toEqual([
      ...originalVolumes,
      'tale_static-assets',
    ]);
    for (const original of originalMounts) {
      const retained = run.docker.containers.find(
        (container) => container.Name === original.name,
      ) as { Mounts: (typeof originalMounts)[number]['mounts'] } | undefined;
      expect(retained?.Mounts).toEqual(expect.arrayContaining(original.mounts));
    }
    const platform = run.docker.containers.find(
      (container) =>
        (container.Config as { Labels: Record<string, string> }).Labels[
          'com.docker.compose.service'
        ] === 'platform',
    );
    expect(platform?.Mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Name: 'tale_static-assets',
          Destination: '/app/static-assets',
          Type: 'volume',
        }),
      ]),
    );
  });

  // What the deployment's recovery-point check reads: whether the store's
  // volume exists, which gateway image the rollout starts, and whether the
  // store has run that image already.
  test('a preview reports the gateway store, the image it would start and whether the store has run it', async () => {
    const fresh = await create();
    expect((await fresh.apply(true)).gateway).toMatchObject({
      volume: false,
      newImage: true,
      running: null,
    });
    // An existing gateway started on the bundle's own image has run it.
    const adopted = await create(true);
    expect((await adopted.apply(true)).gateway).toMatchObject({
      volume: true,
      newImage: false,
    });
    // A source-Compose gateway runs a tag; its image's digest decides.
    const adoptedGateway = gatewayOf(adopted.docker).Config as {
      Image: string;
    };
    const targetImage = adopted.docker.imageMetadata.get(adoptedGateway.Image)!;
    const tag = 'ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:0.5.16';
    adoptedGateway.Image = tag;
    adopted.docker.imageMetadata.set(tag, targetImage);
    expect((await adopted.apply(true)).gateway).toMatchObject({
      newImage: false,
      running: tag,
    });
    adopted.docker.imageMetadata.set(tag, {
      ...targetImage,
      RepoDigests: [
        `ghcr.io/tale-project/tale/tale-sandbox-llm-gateway@sha256:${'0'.repeat(64)}`,
      ],
    });
    expect((await adopted.apply(true)).gateway.newImage).toBe(true);
    // A ready runtime has run its gateway image, stopped or not.
    const run = await create();
    await run.apply();
    const target = (gatewayOf(run.docker).Config as { Image: string }).Image;
    expect((await run.apply(true)).gateway).toEqual({
      volume: true,
      newImage: false,
      target,
      running: target,
    });
    (gatewayOf(run.docker).State as { Running: boolean }).Running = false;
    expect((await run.apply(true)).gateway).toMatchObject({
      newImage: false,
      running: null,
    });
    const stopped = gatewayOf(run.docker);
    run.docker.containers = run.docker.containers.filter(
      (container) => container !== stopped,
    );
    expect((await run.apply(true)).gateway).toMatchObject({
      volume: true,
      newImage: false,
      running: null,
    });
    run.docker.containers.push(stopped);
    // The next release's gateway image is new to that store.
    run.fixture.git('tag', 'v0.5.17');
    run.docker.variantTag = '0.5.17';
    const release = join(run.fixture.directory, 'release-runtime');
    await prepareRuntime(
      {
        repoRoot: run.fixture.repoRoot,
        revision: run.fixture.revision,
        output: release,
        platform: 'linux/amd64',
      },
      run.docker.dependencies(),
    );
    run.docker.calls = [];
    const next = (
      await applyRuntime(
        { ...run.fixture.options, bundleDirectory: release, dryRun: true },
        run.docker.dependencies(),
      )
    ).gateway;
    expect(next.newImage).toBe(true);
    expect(next.target).not.toBe(target);
    expect(mutations(run.docker)).toEqual([]);
    // With the rollout pending, only the container says whether the store has
    // run the target: a stopped one that started has; one Compose created but
    // never started has not.
    const interrupted = await create();
    interrupted.docker.upFailure = true;
    await expect(interrupted.apply()).rejects.toThrow('could not complete');
    (gatewayOf(interrupted.docker).State as { Running: boolean }).Running =
      false;
    expect((await interrupted.apply(true)).gateway).toMatchObject({
      newImage: false,
      running: null,
    });
    Object.assign(gatewayOf(interrupted.docker).State as object, {
      StartedAt: '0001-01-01T00:00:00Z',
    });
    expect((await interrupted.apply(true)).gateway).toMatchObject({
      volume: true,
      newImage: true,
      running: null,
    });
  });

  // A stopped container has started only by a start time in Moby's
  // RFC3339Nano contract after the Unix epoch, fraction included: Docker's
  // zero time, or a value outside the contract or the calendar that a lenient
  // date parser would still read, is none.
  test.each([
    ['2026-09-30T08:01:07.123456789Z', true],
    ['2026-09-30T08:01:07Z', true],
    ['2026-09-30T10:01:07+02:00', true],
    ['1970-01-01T00:00:00.001Z', true],
    ['1970-01-01T01:00:00.001+01:00', true],
    ['1969-12-31T23:00:00.5-01:00', true],
    ['1970-01-01T00:00:00.000000001Z', true],
    ['1970-01-01T00:00:00.000Z', false],
    ['1969-12-31T23:59:59.999999999Z', false],
    ['0001-01-01T00:00:00Z', false],
    ['', false],
    ['1', false],
    ['not-a-timestamp', false],
    ['2026-09-30', false],
    ['2026-09-30T08:01Z', false],
    ['2026-09-30T08:01:07.1234567891Z', false],
    ['2026-02-30T00:00:00Z', false],
    ['2026-09-30T24:00:00Z', false],
    ['2026-09-30T08:01:07+24:00', false],
  ] as const)(
    'a stopped gateway container whose start time reads %p has started: %p',
    async (startedAt, started) => {
      const interrupted = await create();
      interrupted.docker.upFailure = true;
      await expect(interrupted.apply()).rejects.toThrow('could not complete');
      Object.assign(gatewayOf(interrupted.docker).State as object, {
        Running: false,
        StartedAt: startedAt,
      });
      expect((await interrupted.apply(true)).gateway).toMatchObject({
        volume: true,
        newImage: !started,
        running: null,
      });
    },
  );

  // A listing is read only once every line is a record with a name, as
  // Docker's formatter writes it: filtered as it came, a malformed one would
  // hide the gateway store. `listing` is the host's own, one record per line.
  const INVALID = 'Docker returned invalid runtime metadata.';
  const INCOMPLETE = 'Docker volume metadata is incomplete.';
  test.each([
    [
      'the bare names `{{.Name}}` prints',
      () => 'tale_db-data\ntale_llm-gateway-data',
      INVALID,
    ],
    ['a truncated record', () => '{"Name":"tale_llm-gateway-data"', INVALID],
    [
      'a blank line between records',
      (listing: string) => listing.replace('\n', '\n\n'),
      INVALID,
    ],
    [
      'a JSON array of records',
      () => '[{"Name":"tale_llm-gateway-data"}]',
      INCOMPLETE,
    ],
    ['null', () => 'null', INCOMPLETE],
    [
      'a later record without a name',
      (listing: string) => `${listing}\n{"Driver":"local"}`,
      INCOMPLETE,
    ],
    [
      'a later record with an empty name',
      (listing: string) => `${listing}\n{"Driver":"local","Name":""}`,
      INCOMPLETE,
    ],
    [
      'a later record whose name is not a string',
      (listing: string) => `${listing}\n{"Driver":"local","Name":7}`,
      INCOMPLETE,
    ],
  ] as const)(
    'a successful volume listing with %s refuses a preview and a rollout before anything changes',
    async (_name, answer, message) => {
      const run = await create();
      await run.apply();
      run.docker.calls = [];
      const receiptBytes = () =>
        readFileSync(
          join(run.fixture.options.stateDirectory, '.tale/runtime.json'),
        );
      const before = receiptBytes();
      run.docker.volumeListing = (listing) => ({
        success: true,
        exitCode: 0,
        stdout: answer(listing),
        stderr: '',
      });
      for (const dryRun of [true, false])
        await expect(run.apply(dryRun)).rejects.toThrow(message);
      expect(mutations(run.docker)).toEqual([]);
      expect(receiptBytes()).toEqual(before);
    },
  );

  // A name is the volume driver's, so a plugin's is read as it is, however
  // unlike a local volume's it looks.
  test('an empty volume listing, and plugin and foreign volume names, read as they are', async () => {
    const fresh = await create();
    expect((await fresh.apply(true)).gateway.volume).toBe(false);
    fresh.docker.pluginVolumes.push('foreign/plugin-data', 'x');
    expect((await fresh.apply(true)).gateway.volume).toBe(false);
    const run = await create();
    await run.apply();
    run.docker.pluginVolumes.push('foreign/plugin-data', 'x');
    run.docker.volumes.push('other-project_llm-gateway-data', 'a'.repeat(64));
    expect((await run.apply(true)).gateway).toMatchObject({
      volume: true,
      newImage: false,
    });
    run.docker.volumes = run.docker.volumes.filter(
      (name) => name !== 'tale_llm-gateway-data',
    );
    expect((await run.apply(true)).gateway.volume).toBe(false);
  });

  test('fresh and existing previews do not create files or call any Docker mutation', async () => {
    const fresh = await create();
    expect(await fresh.apply(true)).toMatchObject({
      existing: false,
      changed: true,
      dryRun: true,
      backendContainer: null,
    });
    expect(existsSync(fresh.fixture.options.stateDirectory)).toBe(false);
    expect(mutations(fresh.docker)).toEqual([]);
    const old = await create(true);
    expect(await old.apply(true)).toMatchObject({
      existing: true,
      changed: true,
      dryRun: true,
    });
    expect(
      readFileSync(
        join(old.fixture.options.stateDirectory, 'secrets.env'),
        'utf8',
      ),
    ).toBe(old.prior!.secrets);
    expect(existsSync(join(old.fixture.options.stateDirectory, '.tale'))).toBe(
      false,
    );
    expect(mutations(old.docker)).toEqual([]);
  });

  test('adopts all existing volumes and credentials with pending-before-up and exact no-op replay', async () => {
    const { fixture, docker, prior, apply, receipt } = await create(true);
    const originalVolumes = [...docker.volumes];
    docker.onUp = () => {
      const pending = receipt();
      expect(pending.phase).toBe('pending');
      expect(pending.regeneratedSecrets).toEqual([]);
      expect(JSON.stringify(pending)).not.toContain(prior!.values.DB_PASSWORD);
      const env = parseRuntimeEnvironment(
        readFileSync(join(fixture.options.stateDirectory, 'src/.env'), 'utf8'),
        'compose',
      );
      expect(env.DB_PASSWORD).toBe(prior!.values.DB_PASSWORD);
      expect(env.TALE_BOOTSTRAP_PASSWORD).toBeUndefined();
    };
    const result = await apply();
    expect(result).toMatchObject({
      existing: true,
      changed: true,
      dryRun: false,
      regeneratedSecrets: [],
    });
    expect(receipt().phase).toBe('ready');
    expect(docker.volumes).toEqual(originalVolumes);
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'secrets.env'), 'utf8'),
    ).toBe(prior!.secrets);
    const env = readFileSync(join(fixture.options.stateDirectory, 'src/.env'));
    const stageCount = readdirSync(
      join(fixture.options.stateDirectory, '.tale'),
    ).length;
    const up = docker.calls.find(
      ({ args }) => args[0] === 'compose' && args.includes('up'),
    )!;
    expect(up.args).toContain('--no-build');
    expect(up.args).toContain('--env-file');
    expect(up.args).not.toContain('--remove-orphans');
    expect(up.args).not.toContain('--force-recreate');
    expect(up.options?.env?.COMPOSE_PROJECT_NAME).toBeUndefined();
    expect(up.options?.env?.VERSION).toBeUndefined();
    docker.calls = [];
    docker.onUp = null;
    expect(await apply()).toMatchObject({
      existing: true,
      changed: false,
      regeneratedSecrets: [],
    });
    expect(mutations(docker)).toEqual([]);
    expect(
      readdirSync(join(fixture.options.stateDirectory, '.tale')),
    ).toHaveLength(stageCount);
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'src/.env')),
    ).toEqual(env);
    expect(
      statSync(join(fixture.options.stateDirectory, 'secrets.env')).mode &
        0o777,
    ).toBe(0o600);
  });

  test('fresh initialization generates keys once and recovery does not rotate them', async () => {
    const { fixture, docker, apply, receipt } = await create();
    docker.upFailure = true;
    await expect(apply()).rejects.toThrow('could not complete');
    expect(receipt().phase).toBe('pending');
    const before = readFileSync(
      join(fixture.options.stateDirectory, 'secrets.env'),
    );
    docker.upFailure = false;
    expect(await apply()).toMatchObject({ changed: true });
    expect(receipt().phase).toBe('ready');
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'secrets.env')),
    ).toEqual(before);
    const keys = parseRuntimeEnvironment(before.toString(), 'secrets');
    expect(Object.keys(keys)).toHaveLength(9);
    const ready = readFileSync(
      join(fixture.options.stateDirectory, '.tale/runtime.json'),
    );
    expect(ready.toString()).not.toContain(keys.BETTER_AUTH_SECRET);
  });

  test('resumes an interrupted file pair from retained exact pending bytes', async () => {
    const { fixture, docker, prior, apply, receipt } = await create(true);
    docker.upFailure = true;
    await expect(apply()).rejects.toThrow();
    const expectedEnv = readFileSync(
      join(fixture.options.stateDirectory, 'src/.env'),
    );
    writeFileSync(
      join(fixture.options.stateDirectory, 'src/.env'),
      prior!.environment,
    );
    expect(receipt().phase).toBe('pending');
    docker.upFailure = false;
    await apply();
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'src/.env')),
    ).toEqual(expectedEnv);
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'secrets.env'), 'utf8'),
    ).toBe(prior!.secrets);
  });

  test('pending different input and pending byte tampering both refuse activation', async () => {
    const { fixture, docker, apply, receipt } = await create(true);
    docker.upFailure = true;
    await expect(apply()).rejects.toThrow();
    docker.upFailure = false;
    docker.calls = [];
    await expect(
      applyRuntime(
        { ...fixture.options, environment: { SENTRY_DSN: 'changed' } },
        docker.dependencies(),
      ),
    ).rejects.toThrow('different runtime operation is pending');
    expect(mutations(docker)).toEqual([]);
    const before = readFileSync(
      join(fixture.options.stateDirectory, 'src/.env'),
    );
    writeFileSync(
      join(
        fixture.options.stateDirectory,
        '.tale',
        `runtime-${receipt().stage}`,
        '.env',
      ),
      'tampered',
    );
    await expect(apply()).rejects.toThrow('Pending runtime bytes differ');
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'src/.env')),
    ).toEqual(before);
    expect(
      docker.calls.filter(
        ({ args }) => args[0] === 'compose' && args.includes('up'),
      ),
    ).toHaveLength(0);
  });

  test('takes over a pre-start protocol handoff with the verified legacy bridge', async () => {
    const run = await create(true);
    await run.apply();
    const runtimePath = join(
      run.fixture.options.stateDirectory,
      '.tale/runtime.json',
    );
    const current = run.receipt();
    writeFileSync(
      runtimePath,
      JSON.stringify({
        ...current,
        phase: 'pending',
        revision: 'f'.repeat(40),
        bundleSha256: 'e'.repeat(64),
        images: current.images.map((image: Record<string, unknown>) =>
          (image.services as string[]).includes('backend-api')
            ? {
                ...image,
                digest: `sha256:${'f'.repeat(64)}`,
                reference: `${image.repository}@sha256:${'f'.repeat(64)}`,
                revision: 'f'.repeat(40),
                automationWriterProtocol: 2,
              }
            : image,
        ),
      }),
    );
    const pending = run.receipt();
    expect(await run.apply(true)).toMatchObject({ changed: true });
    expect(run.receipt()).toEqual(pending);
    expect(await run.apply()).toMatchObject({ changed: true });
    expect(run.receipt()).toMatchObject({
      phase: 'ready',
      revision: current.revision,
    });
  });

  test.each(['cutover receipt', 'pending writer image'] as const)(
    'refuses a pre-start protocol takeover when %s proves the handoff began',
    async (reason) => {
      const run = await create(true);
      await run.apply();
      const runtimePath = join(
        run.fixture.options.stateDirectory,
        '.tale/runtime.json',
      );
      const current = run.receipt();
      const images = current.images.map((image: Record<string, unknown>) =>
        (image.services as string[]).includes('backend-api')
          ? {
              ...image,
              revision: 'f'.repeat(40),
              automationWriterProtocol: 2,
              ...(reason === 'pending writer image'
                ? {}
                : {
                    digest: `sha256:${'f'.repeat(64)}`,
                    reference: `${image.repository}@sha256:${'f'.repeat(64)}`,
                  }),
            }
          : image,
      );
      writeFileSync(
        runtimePath,
        JSON.stringify({
          ...current,
          phase: 'pending',
          revision: 'f'.repeat(40),
          bundleSha256: 'e'.repeat(64),
          images,
        }),
      );
      if (reason === 'cutover receipt')
        writeFileSync(
          join(
            run.fixture.options.stateDirectory,
            '.tale/automation-cutover.json',
          ),
          '{}',
        );
      await expect(run.apply()).rejects.toThrow(
        'different runtime operation is pending',
      );
    },
  );

  test('refuses a replaced pending directory before any image pull or activation', async () => {
    const { fixture, docker, apply, receipt } = await create(true);
    docker.upFailure = true;
    await expect(apply()).rejects.toThrow();
    const stage = join(
      fixture.options.stateDirectory,
      '.tale',
      `runtime-${receipt().stage}`,
    );
    const moved = join(fixture.directory, 'moved-stage');
    renameSync(stage, moved);
    symlinkSync(moved, stage, 'dir');
    docker.calls = [];
    docker.upFailure = false;
    await expect(apply()).rejects.toThrow('private regular directory');
    expect(mutations(docker)).toEqual([]);
  });

  test.each(['project', 'directory', 'volume', 'replica'] as const)(
    'refuses conflicting existing %s identity without mutation',
    async (kind) => {
      const { docker, apply } = await create(true);
      const container = docker.containers[0] as {
        Config: { Labels: Record<string, string> };
        Mounts: { Name: string }[];
      };
      if (kind === 'project')
        container.Config.Labels['com.docker.compose.project'] = 'other';
      if (kind === 'directory')
        container.Config.Labels['com.docker.compose.project.working_dir'] =
          '/different/source';
      if (kind === 'replica')
        container.Config.Labels['com.docker.compose.container-number'] = '2';
      if (kind === 'volume') container.Mounts[0].Name = 'different_db-data';
      await expect(apply()).rejects.toThrow();
      expect(mutations(docker)).toEqual([]);
    },
  );

  test.each([
    { Driver: 'bridge', Internal: false, EnableIPv6: false },
    { Driver: 'bridge', Internal: true, EnableIPv6: true },
    { Driver: 'overlay', Internal: true, EnableIPv6: false },
  ])('refuses an unsafe existing sandbox network', async (network) => {
    const { docker, apply } = await create(true);
    docker.unsafeNetwork = network;
    await expect(apply()).rejects.toThrow('internal bridge');
    expect(mutations(docker)).toEqual([]);
  });

  test('does not initialize over orphaned volumes or a partial unowned stack', async () => {
    const fresh = await create();
    fresh.docker.volumes = ['tale_db-data'];
    await expect(fresh.apply()).rejects.toThrow(
      'Unowned existing data volumes',
    );
    expect(mutations(fresh.docker)).toEqual([]);
    const old = await create(true);
    old.docker.containers.pop();
    await expect(old.apply()).rejects.toThrow('incomplete');
    expect(mutations(old.docker)).toEqual([]);
  });

  test('refuses mixed source revisions already running in an unowned legacy stack', async () => {
    const { docker, apply } = await create(true);
    const container = docker.containers[0] as { Config: { Image: string } };
    const metadata = docker.imageMetadata.get(container.Config.Image)!;
    docker.imageMetadata.set(container.Config.Image, {
      ...metadata,
      Config: {
        Labels: {
          'org.opencontainers.image.revision': 'f'.repeat(40),
        },
      },
    });
    await expect(apply()).rejects.toThrow('source revisions');
    expect(mutations(docker)).toEqual([]);
  });

  test('refuses a destination architecture different from the prepared runtime', async () => {
    const { fixture, docker } = await create(true);
    const execute: typeof docker.execute = async (command, args, options) => {
      if (args[0] === 'info')
        return {
          success: true,
          stdout: 'linux/aarch64',
          stderr: '',
          exitCode: 0,
        };
      return docker.execute(command, args, options);
    };
    await expect(
      applyRuntime(fixture.options, {
        ...docker.dependencies(),
        exec: execute,
      }),
    ).rejects.toThrow('destination platform');
    expect(mutations(docker)).toEqual([]);
  });

  test('refuses an engine that cannot pull the images before any change', async () => {
    const { fixture, docker } = await create(true);
    const execute: typeof docker.execute = async (command, args, options) => {
      if (args[0] === 'version')
        return {
          success: true,
          stdout: JSON.stringify({
            Version: '20.10.24',
            Components: [{ Name: 'Engine', Version: '20.10.24' }],
          }),
          stderr: '',
          exitCode: 0,
        };
      return docker.execute(command, args, options);
    };
    await expect(
      applyRuntime(fixture.options, {
        ...docker.dependencies(),
        exec: execute,
      }),
    ).rejects.toThrow('older than 24.0');
    expect(mutations(docker)).toEqual([]);
  });

  test('holds unexpected managed file changes instead of overwriting them', async () => {
    const { fixture, docker, apply } = await create(true);
    await apply();
    docker.calls = [];
    const file = join(fixture.options.stateDirectory, 'src/.env');
    writeFileSync(file, readFileSync(file, 'utf8') + 'UNREVIEWED=1\n');
    await expect(apply()).rejects.toThrow('file drift');
    expect(mutations(docker)).toEqual([]);
  });

  test('refuses a fixed container name already used by another deployment', async () => {
    const { docker, apply } = await create();
    docker.foreignNames = ['tale-db'];
    await expect(apply()).rejects.toThrow('another deployment');
    expect(mutations(docker)).toEqual([]);
  });

  test('adopts the shared CLI backup volume created before a runtime rollout', async () => {
    const { fixture, docker, apply } = await create(true);
    docker.volumes.push(`${fixture.options.composeProject}_${BACKUP_VOLUME}`);
    expect((await apply()).existing).toBe(true);
    expect(
      docker.calls.some(
        ({ args }) => args[0] === 'compose' && args.includes('up'),
      ),
    ).toBe(true);
  });

  test.each(['backups-other', 'unrecognized', 'backups-invalid'])(
    'refuses an arbitrary existing volume named %s',
    async (volume) => {
      const { fixture, docker, apply } = await create(true);
      docker.volumes.push(`${fixture.options.composeProject}_${volume}`);
      await expect(apply()).rejects.toThrow('unrecognized data volumes');
      expect(mutations(docker)).toEqual([]);
    },
  );

  test('a backup volume alone cannot authorize adopting unmanaged state', async () => {
    const { fixture, docker, apply } = await create();
    docker.volumes.push(`${fixture.options.composeProject}_${BACKUP_VOLUME}`);
    await expect(apply()).rejects.toThrow('Unowned existing data volumes');
    expect(mutations(docker)).toEqual([]);
  });

  test('health failure leaves a pending receipt and the complete old secret bytes', async () => {
    const { fixture, docker, prior, apply, receipt } = await create(true);
    docker.onUp = () => {
      const container = docker.containers[0] as {
        State: { Health: { Status: string } };
      };
      container.State.Health.Status = 'unhealthy';
    };
    await expect(apply()).rejects.toThrow('did not become healthy');
    expect(receipt().phase).toBe('pending');
    expect(
      readFileSync(join(fixture.options.stateDirectory, 'secrets.env'), 'utf8'),
    ).toBe(prior!.secrets);
  });

  test('missing health evidence cannot satisfy a declared backend check', async () => {
    const { docker, apply, receipt } = await create();
    docker.onUp = () => {
      const backend = docker.containers.find(
        (container) =>
          (container.Config as { Labels: Record<string, string> }).Labels[
            'com.docker.compose.service'
          ] === 'backend-api',
      )!;
      backend.State = { Running: true };
    };
    await expect(apply()).rejects.toThrow('did not become healthy');
    expect(receipt().phase).toBe('pending');
  });

  // A pre-deploy snapshot pauses the containers of every data volume, and
  // Docker reports each unhealthy until its next probe. A replay that changes
  // nothing must wait that out: Compose refuses at once to start a service
  // whose dependency reads unhealthy (the platform depends on the proxy),
  // which failed the first attempt of every deploy that took a snapshot.
  test.each(['unhealthy', 'starting'] as const)(
    'awaits a running service that briefly reads %s instead of running Compose again',
    async (status) => {
      const { docker, apply, receipt } = await create(true);
      await apply();
      const ready = receipt();
      docker.staleHealth.set('proxy', { status, reads: 2 });
      docker.calls = [];

      expect(await apply()).toMatchObject({ existing: true, changed: false });
      expect(mutations(docker)).toEqual([]);
      expect(docker.staleHealth.size).toBe(0);
      expect(receipt()).toEqual(ready);
    },
  );

  test('fails an unchanged replay whose service stays unhealthy, without running Compose', async () => {
    const { docker, apply, receipt } = await create(true);
    await apply();
    const ready = receipt();
    docker.staleHealth.set('proxy', { status: 'unhealthy', reads: Infinity });
    docker.calls = [];

    await expect(apply()).rejects.toThrow(
      'Managed runtime did not become healthy (proxy: unhealthy); pending state is retained for recovery.',
    );
    expect(mutations(docker)).toEqual([]);
    expect(receipt()).toEqual(ready);
  });

  test.each(['stopped', 'image'] as const)(
    'still hands a %s service to Compose',
    async (drift) => {
      const { docker, apply } = await create(true);
      await apply();
      const proxy = docker.containers.find(
        (container) =>
          (container.Config as { Labels: Record<string, string> }).Labels[
            'com.docker.compose.service'
          ] === 'proxy',
      )!;
      if (drift === 'stopped')
        (proxy.State as { Running: boolean }).Running = false;
      else
        (proxy.Config as { Image: string }).Image =
          `foreign@sha256:${'f'.repeat(64)}`;
      docker.calls = [];

      expect(await apply()).toMatchObject({ changed: true });
      expect(mutations(docker).some(({ args }) => args[0] === 'compose')).toBe(
        true,
      );
    },
  );

  test('verifies local spawner aliases again on unchanged replay', async () => {
    const { docker, apply } = await create(true);
    await apply();
    const image = docker.imageMetadata.get('tale-sandbox-runtime:latest')!;
    docker.imageMetadata.set('tale-sandbox-runtime:latest', {
      ...image,
      RepoDigests: [
        `ghcr.io/tale-project/tale/tale-sandbox-runtime@sha256:${hash('wrong')}`,
      ],
    });
    docker.calls = [];
    await expect(apply()).rejects.toThrow('alias drift');
    expect(mutations(docker)).toEqual([]);
  });

  test.each(['name', 'composeProject', 'tlsEmail'] as const)(
    'refuses a trailing newline in %s before Docker reads',
    async (field) => {
      const { fixture, docker } = await create(true);
      const value =
        field === 'tlsEmail' ? 'admin@example.invalid' : fixture.options[field];
      await expect(
        applyRuntime(
          { ...fixture.options, [field]: value + '\n' },
          docker.dependencies(),
        ),
      ).rejects.toThrow();
      expect(docker.calls).toHaveLength(0);
    },
  );

  test('reports no newly generated secrets on the repeat after fresh initialization', async () => {
    const { apply } = await create();
    expect((await apply()).regeneratedSecrets).toHaveLength(9);
    expect((await apply()).regeneratedSecrets).toEqual([]);
  });
});
