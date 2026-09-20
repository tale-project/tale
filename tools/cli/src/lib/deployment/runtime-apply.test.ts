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
async function create(legacy = false) {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
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
    expect(Object.keys(keys)).toHaveLength(10);
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
    expect((await apply()).regeneratedSecrets).toHaveLength(10);
    expect((await apply()).regeneratedSecrets).toEqual([]);
  });
});
