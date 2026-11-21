import { afterEach, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { CliError, ExitCode } from '../../utils/fail';
import { generateColorCompose } from '../compose/generators/generate-color-compose';
import { setProjectId } from '../project/project-context';
import {
  AUTOMATION_PROTOCOL_LABEL,
  AUTOMATION_PROTOCOL_SOURCE,
} from './automation-model';
import {
  bundledBackendIdentity,
  imageWriterProtocol,
  installedAutomationProtocol,
} from './automation-protocol';
import { applyRuntime } from './runtime-apply';
import type { RuntimeDependencies } from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import {
  installLegacy,
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';
import { sourceAutomationProtocol } from './source-automation-protocol';
import {
  admitPendingAutomationColor,
  admitTagAutomationImage,
  tagDeploymentProtocol,
} from './tag-automation-protocol';

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});

const ok = (value: unknown) => ({
  success: true,
  exitCode: 0,
  stdout: typeof value === 'string' ? value : JSON.stringify(value),
  stderr: '',
});
const db = {
  Id: 'a'.repeat(64),
  Image: `sha256:${'b'.repeat(64)}`,
  RestartCount: 0,
  Config: {
    Image: 'example/db@sha256:' + 'b'.repeat(64),
    Labels: {
      'com.docker.compose.project': 'tale',
      'com.docker.compose.service': 'db',
      'com.docker.compose.container-number': '1',
      'com.docker.compose.oneoff': 'False',
    },
  },
  State: { Running: true, StartedAt: '2026-10-08T00:00:00.000000001Z' },
};
const ids = ['0001_initial.sql', '0163_automation_legacy_protocol.sql'];

test('ledger read preserves bounded stdin transport and refuses a changed DB incarnation', async () => {
  let reads = 0;
  const dependencies: RuntimeDependencies = {
    exec: async (_command, args, options) => {
      expect(options?.timeout).toBe(15);
      expect(options?.maxOutputBytes).toBe(1_048_576);
      expect(options?.silent).toBe(true);
      if (args[0] === 'exec') {
        expect(args).toEqual(['exec', '-i', db.Id, 'sh', '-s']);
        expect(options?.stdin).toContain('BEGIN READ ONLY');
        expect(options?.stdin).toContain('pg_catalog.pg_class');
        return ok({ schema: 'tale', ids });
      }
      reads += 1;
      return ok([{ ...db, RestartCount: reads > 1 ? 1 : 0 }]);
    },
  };
  await expect(
    installedAutomationProtocol(db.Id, 'tale', dependencies),
  ).rejects.toThrow('unknown');
  expect(reads).toBe(2);
});

test('missing, malformed and ambiguous ledger output never becomes a legacy floor', async () => {
  for (const ledger of [
    '',
    'null',
    '{',
    '{}',
    '[]',
    '{"schema":"tale","ids":[]}',
    JSON.stringify({ schema: 'tale', ids: [...ids, ids[0]] }),
    JSON.stringify({ schema: 'tale', ids }) +
      '\n' +
      JSON.stringify({ schema: 'public', ids }),
  ]) {
    const deps: RuntimeDependencies = {
      exec: async (_c, args) => (args[0] === 'exec' ? ok(ledger) : ok([db])),
    };
    await expect(
      installedAutomationProtocol(db.Id, 'tale', deps),
    ).rejects.toThrow('unknown');
  }
  const deps: RuntimeDependencies = {
    exec: async (_c, args) =>
      args[0] === 'exec'
        ? ok({ schema: 'public', ids: ['0001_initial.sql'] })
        : ok([db]),
  };
  expect(await installedAutomationProtocol(db.Id, 'tale', deps)).toBe(1);
});

test('only understood image capability values are admitted', () => {
  expect(imageWriterProtocol(undefined)).toBe(1);
  expect(imageWriterProtocol(null)).toBe(1);
  expect(imageWriterProtocol({ [AUTOMATION_PROTOCOL_LABEL]: '2' })).toBe(2);
  for (const value of ['', '0', '3', '02', '2\n', ' 2', 'Infinity'])
    expect(() =>
      imageWriterProtocol({ [AUTOMATION_PROTOCOL_LABEL]: value }),
    ).toThrow('unsupported');
});

test('tag admission binds source and digest and all backend roles consume that digest', async () => {
  setProjectId('tale');
  const config = { registry: 'ghcr.io/tale-project/tale', version: '0.5.99' };
  const reference = `${config.registry}/tale-platform@sha256:${'c'.repeat(64)}`;
  const metadata = {
    Id: `sha256:${'d'.repeat(64)}`,
    Os: 'linux',
    Architecture: 'amd64',
    RepoDigests: [reference],
    Config: {
      Labels: {
        [AUTOMATION_PROTOCOL_LABEL]: '2',
        'org.opencontainers.image.revision': 'e'.repeat(40),
        'org.opencontainers.image.version': config.version,
        'org.opencontainers.image.source':
          'https://github.com/tale-project/tale',
      },
    },
  };
  const deps: RuntimeDependencies = { exec: async () => ok([metadata]) };
  expect(await admitTagAutomationImage(config, 2, deps)).toBe(reference);
  await expect(
    admitTagAutomationImage(config, 1, {
      exec: async (_c, args) => (args[0] === 'ps' ? ok(db.Id) : ok([metadata])),
    }),
  ).rejects.toThrow('cutover barrier');
  expect(
    await admitTagAutomationImage(config, 1, {
      exec: async (_c, args) => (args[0] === 'ps' ? ok('') : ok([metadata])),
    }),
  ).toBe(reference);
  const compose = parse(
    generateColorCompose({ ...config, platformImage: reference }, 'green'),
  );
  for (const role of ['platform', 'backend-api', 'backend-worker'])
    expect(compose.services[role].image).toBe(reference);
  for (const key of [
    AUTOMATION_PROTOCOL_LABEL,
    'org.opencontainers.image.version',
    'org.opencontainers.image.revision',
    'org.opencontainers.image.source',
  ]) {
    const labels = { ...metadata.Config.Labels, [key]: 'invalid' };
    await expect(
      admitTagAutomationImage(config, 2, {
        exec: async () => ok([{ ...metadata, Config: { Labels: labels } }]),
      }),
    ).rejects.toThrow();
  }
  await expect(
    admitTagAutomationImage(config, 2, {
      exec: async () => ok([{ ...metadata, Config: {} }]),
    }),
  ).rejects.toThrow('automation writer protocol');
  expect(
    await admitTagAutomationImage(config, 1, {
      exec: async () => ok([{ ...metadata, Config: {} }]),
    }),
  ).toBeUndefined();
  // Before a pull the selected tag is simply not on the host: the failed read
  // names that image and the read, not the installed writer.
  const failure = await admitTagAutomationImage(config, 2, {
    exec: async () => ({
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error response from daemon: No such image',
    }),
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CliError);
  expect((failure as CliError).info.code).toBe(ExitCode.ExternalDep);
  expect((failure as CliError).message).toContain(
    `\`docker image inspect ${config.registry}/tale-platform:${config.version}\` failed`,
  );
  expect((failure as CliError).message).not.toContain('installed');
});

test('fresh tag deployment requires absence of existing database and project volumes', async () => {
  const noState: RuntimeDependencies = { exec: async () => ok('') };
  expect(await tagDeploymentProtocol('tale', false, noState)).toBe(1);
  await expect(tagDeploymentProtocol('tale', true, noState)).rejects.toThrow(
    'existing database',
  );
  await expect(
    tagDeploymentProtocol('tale', false, {
      exec: async (_c, args) =>
        ok(args.includes('label=com.docker.compose.service=db') ? '' : db.Id),
    }),
  ).rejects.toThrow('existing database');
  await expect(
    tagDeploymentProtocol('tale', false, {
      exec: async (_c, args) =>
        ok(args[0] === 'volume' ? { Name: 'tale_db-data' } : ''),
    }),
  ).rejects.toThrow('existing database');
});

/** What `tale init` makes of a folder named `2024-site`. */
const digitLed = '2024-site-abc123';

test('a digit-led project deploys fresh', async () => {
  const noState: RuntimeDependencies = { exec: async () => ok('') };
  expect(await tagDeploymentProtocol(digitLed, false, noState)).toBe(1);
});

test('a digit-led project deploys over its existing database', async () => {
  const api = 'c'.repeat(64),
    worker = 'd'.repeat(64);
  const labels = (project: string, service: string) => ({
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
    'com.docker.compose.container-number': '1',
    'com.docker.compose.oneoff': 'False',
  });
  const deps: RuntimeDependencies = {
    exec: async (_c, args) => {
      if (args[0] === 'ps')
        return ok(
          args.at(-1)?.includes('.Label')
            ? args.includes(`label=com.docker.compose.project=${digitLed}-blue`)
              ? `${api}\tbackend-api\n${worker}\tbackend-worker`
              : ''
            : db.Id,
        );
      if (args[0] === 'image')
        return ok(args.slice(2).map((Id) => ({ Id, Config: { Labels: {} } })));
      if (args[0] === 'exec') return ok({ schema: 'tale', ids });
      if (args[2] === db.Id)
        return ok([
          { ...db, Config: { ...db.Config, Labels: labels(digitLed, 'db') } },
        ]);
      return ok(
        args.slice(2).map((id) => ({
          Id: id,
          Image: db.Image,
          RestartCount: db.RestartCount,
          State: db.State,
          Config: {
            Labels: labels(
              `${digitLed}-blue`,
              id === api ? 'backend-api' : 'backend-worker',
            ),
            Env: ['DATABASE_URL=postgresql://tale:synthetic@db:5432/tale_app'],
          },
        })),
      );
    },
  };
  // The backend custody check of the project and its colours, then the
  // database's ledger, which is at protocol 2.
  expect(await tagDeploymentProtocol(digitLed, true, deps)).toBe(2);
});

test('target source capability uses committed bytes and rejects unsupported declarations', () => {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const file = join(fixture.repoRoot, AUTOMATION_PROTOCOL_SOURCE);
  writeFileSync(file, 'export const ENGINE_PROTOCOL = 2;\n');
  expect(sourceAutomationProtocol(fixture.repoRoot, fixture.revision)).toBe(1);
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'new writer protocol');
  expect(
    sourceAutomationProtocol(
      fixture.repoRoot,
      fixture.git('rev-parse', 'HEAD'),
    ),
  ).toBe(2);
  rmSync(file);
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'historical missing protocol source');
  expect(
    sourceAutomationProtocol(
      fixture.repoRoot,
      fixture.git('rev-parse', 'HEAD'),
    ),
  ).toBe(1);
  writeFileSync(file, 'export const ENGINE_PROTOCOL = 3;\n');
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'unsupported future protocol');
  expect(() =>
    sourceAutomationProtocol(
      fixture.repoRoot,
      fixture.git('rev-parse', 'HEAD'),
    ),
  ).toThrow('unsupported');
});

test('an installed automation protocol fence refuses a legacy target before managed runtime mutation', async () => {
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
  installLegacy(fixture, docker);
  const envPath = join(fixture.options.stateDirectory, 'src/.env');
  const before = readFileSync(envPath);
  docker.calls = [];
  const dependencies = docker.dependencies();
  await expect(
    applyRuntime(fixture.options, {
      ...dependencies,
      exec: async (command, args, options) => {
        if (args[0] === 'exec' && args.includes('-i')) {
          return {
            success: true,
            exitCode: 0,
            stdout:
              '{"schema":"tale","ids":["0001_initial.sql","0163_automation_legacy_protocol.sql"]}',
            stderr: '',
          };
        }
        return docker.execute(command, args, options);
      },
    }),
  ).rejects.toThrow('automation writer protocol');
  expect(readFileSync(envPath)).toEqual(before);
  expect(docker.calls.some(({ args }) => args[0] === 'compose')).toBe(false);
  expect(docker.calls.some(({ args }) => args[0] === 'pull')).toBe(false);
});

test('managed apply adopts the installed stack of a digit-led Compose project', async () => {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  fixture.options.composeProject = digitLed;
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
  installLegacy(fixture, docker);
  docker.calls = [];
  expect(
    await applyRuntime(fixture.options, docker.dependencies()),
  ).toMatchObject({ existing: true, changed: true });
  // The installed protocol was read through the backend custody check.
  expect(
    docker.calls.some(
      ({ args }) =>
        args[0] === 'ps' &&
        args.includes(`label=com.docker.compose.project=${digitLed}`) &&
        args.at(-1)?.includes('.Label'),
    ),
  ).toBe(true);
});

for (const interval of ['already-created writer', 'during pull'] as const) {
  test(`managed apply refuses a floor advanced by ${interval} before mutation`, async () => {
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
    installLegacy(fixture, docker);
    const envPath = join(fixture.options.stateDirectory, 'src/.env');
    const before = readFileSync(envPath);
    let pulled = false;
    docker.calls = [];
    await expect(
      applyRuntime(fixture.options, {
        ...docker.dependencies(),
        exec: async (c, args, options) => {
          if (args[0] === 'pull') pulled = true;
          if (args[0] === 'image' && args[2]?.startsWith('sha256:'))
            return ok(
              args.slice(2).map((Id) => ({
                Id,
                Config: {
                  Labels: {
                    [AUTOMATION_PROTOCOL_LABEL]:
                      interval === 'already-created writer' ? '2' : '1',
                  },
                },
              })),
            );
          if (args[0] === 'exec' && args.includes('-i'))
            return ok({
              schema: 'tale',
              ids: pulled ? ids : ['0001_initial.sql'],
            });
          return docker.execute(c, args, options);
        },
      }),
    ).rejects.toThrow('automation writer protocol');
    expect(readFileSync(envPath)).toEqual(before);
    expect(docker.calls.some((c) => c.args[0] === 'compose')).toBe(false);
    expect(docker.calls.some((c) => c.args[0] === 'tag')).toBe(false);
  });
}

test('tag floor never substitutes the bundled ledger for a current or removed external DB override', async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    APP_DB_NAME: process.env.APP_DB_NAME,
  };
  let calls = 0;
  const api = 'c'.repeat(64),
    worker = 'd'.repeat(64);
  let connection = 'postgresql://tale:synthetic@external.invalid:5432/tale_app';
  const deps: RuntimeDependencies = {
    exec: async (_c, args) => {
      calls += 1;
      if (args[0] === 'ps')
        return ok(
          args.at(-1)?.includes('.Label')
            ? args.includes('label=com.docker.compose.project=tale-blue')
              ? `${api}\tbackend-api\n${worker}\tbackend-worker`
              : ''
            : db.Id,
        );
      if (args[0] === 'image')
        return ok(args.slice(2).map((Id) => ({ Id, Config: { Labels: {} } })));
      if (args[0] === 'exec') return ok({ schema: 'tale', ids });
      if (args[2] === db.Id) return ok([db]);
      return ok(
        args.slice(2).map((id) => ({
          Id: id,
          Image: db.Image,
          RestartCount: db.RestartCount,
          State: db.State,
          Config: {
            Labels: {
              'com.docker.compose.project': 'tale-blue',
              'com.docker.compose.service':
                id === api ? 'backend-api' : 'backend-worker',
              'com.docker.compose.container-number': '1',
              'com.docker.compose.oneoff': 'False',
            },
            Env: [
              `DATABASE_URL=${connection}`,
              'OTHER_SECRET=must-never-leave-reader',
            ],
          },
        })),
      );
    },
  };
  try {
    process.env.DATABASE_URL = 'postgresql://synthetic@external.invalid/db';
    await expect(tagDeploymentProtocol('tale', false, deps)).rejects.toThrow(
      'Custom database',
    );
    expect(calls).toBe(0);
    delete process.env.DATABASE_URL;
    process.env.APP_DB_NAME = 'other';
    await expect(tagDeploymentProtocol('tale', true, deps)).rejects.toThrow(
      'Custom database',
    );
    expect(calls).toBe(0);
    delete process.env.APP_DB_NAME;
    // Removing the override from .env does not change the installed connection.
    await expect(tagDeploymentProtocol('tale', true, deps)).rejects.toThrow(
      'Custom database',
    );
    connection = 'postgresql://tale:synthetic@db:5432/other';
    await expect(tagDeploymentProtocol('tale', true, deps)).rejects.toThrow(
      'Custom database',
    );
    connection = 'postgresql://tale:synthetic@db:5432/tale_app';
    expect(await tagDeploymentProtocol('tale', true, deps)).toBe(2);
    let inventories = 0;
    await expect(
      tagDeploymentProtocol('tale', true, {
        exec: async (c, args, o) => {
          if (args[0] === 'container' && args[2] === api && ++inventories === 2)
            connection =
              'postgresql://tale:synthetic@external.invalid:5432/tale_app';
          return deps.exec!(c, args, o);
        },
      }),
    ).rejects.toThrow('Custom database');
  } finally {
    for (const key of ['DATABASE_URL', 'APP_DB_NAME'] as const)
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
  }
});

test('managed apply cannot start protocol two over an unsupported legacy writer', async () => {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  const prepare = () =>
    prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
      },
      docker.dependencies(),
    );
  await prepare();
  installLegacy(fixture, docker);
  writeFileSync(
    join(fixture.repoRoot, AUTOMATION_PROTOCOL_SOURCE),
    'export const ENGINE_PROTOCOL = 2;\n',
  );
  writeFileSync(
    join(
      fixture.repoRoot,
      'services/platform/backend/db/migrations/0163_automation_legacy_protocol.sql',
    ),
    'SELECT 1;\n',
  );
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'new protocol target');
  fixture.revision = fixture.git('rev-parse', 'HEAD');
  fixture.options.bundleDirectory = join(fixture.directory, 'protocol-two');
  await prepare();
  docker.calls = [];
  await expect(
    applyRuntime(fixture.options, {
      ...docker.dependencies(),
      exec: async (command, args, options) => {
        if (
          args[0] === 'ps' &&
          args.some(
            (arg) =>
              arg === 'label=com.docker.compose.project=tale-blue' ||
              arg === 'label=com.docker.compose.project=tale-green',
          )
        )
          return ok('');
        return docker.execute(command, args, options);
      },
    }),
  ).rejects.toThrow('verified b493');
  expect(
    docker.calls.some(
      (call) => call.args[0] === 'compose' && call.args.includes('up'),
    ),
  ).toBe(false);
  expect(docker.calls.some((call) => call.args[0] === 'stop')).toBe(false);
});

test('managed source protocol requires its migration and rechecks the immutable image before mutation', async () => {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  writeFileSync(
    join(fixture.repoRoot, AUTOMATION_PROTOCOL_SOURCE),
    'export const ENGINE_PROTOCOL = 2;\n',
  );
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'declare protocol two');
  fixture.revision = fixture.git('rev-parse', 'HEAD');
  const docker = new RuntimeDockerFixture(fixture);
  const prepare = () =>
    prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
      },
      docker.dependencies(),
    );
  await expect(prepare()).rejects.toThrow('source migration');
  expect(docker.calls).toHaveLength(0);
  writeFileSync(
    join(
      fixture.repoRoot,
      'services/platform/backend/db/migrations/0163_automation_legacy_protocol.sql',
    ),
    'SELECT 1;\n',
  );
  fixture.git('add', '.');
  fixture.git('commit', '-qm', 'include protocol migration');
  fixture.revision = fixture.git('rev-parse', 'HEAD');
  const bundle = await prepare();
  expect(bundle.automationWriterProtocol).toBe(2);
  expect(
    bundle.images.find((i) => i.services.includes('platform'))
      ?.automationWriterProtocol,
  ).toBe(2);
  docker.automationProtocol = undefined;
  docker.calls = [];
  await expect(
    applyRuntime(fixture.options, docker.dependencies()),
  ).rejects.toThrow('prepared capability');
  expect(docker.calls.some((c) => c.args[0] === 'compose')).toBe(false);
  expect(
    docker.calls.some((c) => c.args[0] === 'volume' && c.args[1] === 'create'),
  ).toBe(false);
  docker.automationProtocol = '2';
  expect(
    (await applyRuntime(fixture.options, docker.dependencies())).changed,
  ).toBe(true);
});

test('managed adoption refuses a removed external override still installed in its backend', async () => {
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
  installLegacy(fixture, docker);
  for (const c of docker.containers) {
    const config = c.Config as {
      Labels: Record<string, string>;
      Env: string[];
    };
    if (config.Labels['com.docker.compose.service'] === 'backend-worker')
      config.Env = [
        'DATABASE_URL=postgresql://tale:synthetic@external.invalid:5432/tale_app',
      ];
  }
  docker.calls = [];
  await expect(
    applyRuntime(fixture.options, docker.dependencies()),
  ).rejects.toThrow('Custom database');
  expect(docker.calls.some((c) => c.args[0] === 'compose')).toBe(false);
  expect(docker.calls.some((c) => c.args[0] === 'pull')).toBe(false);
});

test('pending promotion checks every backend role against the admitted immutable image', async () => {
  const imageId = `sha256:${'e'.repeat(64)}`;
  const roles = ['platform', 'backend-api', 'backend-worker'];
  const containers = roles.map((role, index) => ({
    Id: String(index + 1).repeat(64),
    Image: imageId,
    Config: {
      Labels: {
        'com.docker.compose.project': 'tale-green',
        'com.docker.compose.service': role,
        'com.docker.compose.container-number': '1',
        'com.docker.compose.oneoff': 'False',
      },
    },
  }));
  const deps: RuntimeDependencies = {
    exec: async (_c, args) =>
      args[0] === 'image'
        ? ok([{ Id: imageId }])
        : args[0] === 'ps'
          ? ok(containers.map((c) => c.Id).join('\n'))
          : ok(containers),
  };
  const reference = `ghcr.io/tale-project/tale/tale-platform@sha256:${'f'.repeat(64)}`;
  await expect(
    admitPendingAutomationColor('tale-green', reference, 2, deps),
  ).resolves.toBeUndefined();
  containers[2].Image = `sha256:${'a'.repeat(64)}`;
  await expect(
    admitPendingAutomationColor('tale-green', reference, 2, deps),
  ).rejects.toThrow('Pending automation writer');
  containers.pop();
  await expect(
    admitPendingAutomationColor('tale-green', reference, 2, deps),
  ).rejects.toThrow('Pending automation writer');
  await expect(
    admitPendingAutomationColor('tale-green', undefined, 2, deps),
  ).rejects.toThrow('no admitted');
});

test('pending promotion asks for the services the colour is to run, and judges every writer it finds', async () => {
  const imageId = `sha256:${'e'.repeat(64)}`;
  const container = (service: string, index: number, image = imageId) => ({
    Id: String(index).repeat(64),
    Image: image,
    Config: {
      Labels: {
        'com.docker.compose.project': 'tale-green',
        'com.docker.compose.service': service,
        'com.docker.compose.container-number': '1',
        'com.docker.compose.oneoff': 'False',
      },
    },
  });
  let containers = [container('platform', 1)];
  const deps: RuntimeDependencies = {
    exec: async (_c, args) =>
      args[0] === 'image'
        ? ok([{ Id: imageId }])
        : args[0] === 'ps'
          ? ok(containers.map((c) => c.Id).join('\n'))
          : ok(containers),
  };
  const reference = `ghcr.io/tale-project/tale/tale-platform@sha256:${'f'.repeat(64)}`;
  const admit = (
    services?: Parameters<typeof admitPendingAutomationColor>[4],
  ) => admitPendingAutomationColor('tale-green', reference, 2, deps, services);

  // One process is the whole colour: nothing else has to be there.
  await expect(admit(['platform'])).resolves.toBeUndefined();
  // Asked for the three services, as a caller that names none is.
  await expect(admit()).rejects.toThrow('Pending automation writer');
  // With the jobs apart, the worker has to be there.
  await expect(admit(['platform', 'backend-worker'])).rejects.toThrow(
    'Pending automation writer',
  );
  containers = [container('platform', 1), container('backend-worker', 2)];
  await expect(admit(['platform', 'backend-worker'])).resolves.toBeUndefined();
  // A writer of a service the colour is not to run is still a writer: left
  // by an earlier deploy on another image, it refuses the colour.
  containers = [
    container('platform', 1),
    container('backend-worker', 2, `sha256:${'a'.repeat(64)}`),
  ];
  await expect(admit(['platform'])).rejects.toThrow(
    'Pending automation writer',
  );
  // On the admitted image it is no reason to refuse.
  containers = [container('platform', 1), container('backend-worker', 2)];
  await expect(admit(['platform'])).resolves.toBeUndefined();
});

test('malformed installed backend metadata cannot leak credentials through decode errors', async () => {
  const sentinel = 'synthetic-credential-must-stay-private';
  let message = '';
  try {
    await bundledBackendIdentity(['tale'], {
      exec: async (_c, args) =>
        ok(
          args[0] === 'ps'
            ? `${'a'.repeat(64)}\tbackend-api\n${'b'.repeat(64)}\tbackend-worker`
            : `[{"Config":{"Env":["DATABASE_URL=${sentinel}"]}},INVALID`,
        ),
    });
  } catch (error) {
    message = String(error);
  }
  expect(message).toContain('metadata is unreadable');
  expect(message).not.toContain(sentinel);
  expect(message).not.toContain('DATABASE_URL');
});

/**
 * A colour runs its writers as `backend-api` and `backend-worker`, or inside
 * `platform` (compose/app-tier.ts). The census tells a `platform` that is a
 * backend process from the web tier of a colour of three services by the role
 * it runs.
 */
const BUNDLED = 'DATABASE_URL=postgresql://tale:synthetic@db:5432/tale_app';
interface Installed {
  id: string;
  project: string;
  service: string;
  env?: string[];
}
function installed(
  containers: Installed[],
  imageLabels: Record<string, string> = {},
): RuntimeDependencies & { inspected: string[][] } {
  const inspected: string[][] = [];
  return {
    inspected,
    exec: async (_c, args) => {
      if (args[0] === 'ps') {
        if (!args.at(-1)?.includes('.Label')) return ok(db.Id);
        const project = args
          .find((arg) => arg.startsWith('label=com.docker.compose.project='))
          ?.split('=')
          .at(-1);
        return ok(
          containers
            .filter((container) => container.project === project)
            .map((container) => `${container.id}\t${container.service}`)
            .join('\n'),
        );
      }
      if (args[0] === 'image')
        return ok(
          args.slice(2).map((Id) => ({ Id, Config: { Labels: imageLabels } })),
        );
      if (args[0] === 'container' && args[1] === 'inspect') {
        inspected.push(args.slice(2));
        return ok(
          args.slice(2).map((id) => {
            const container = containers.find((entry) => entry.id === id);
            if (container === undefined) throw new Error(`no container ${id}`);
            return {
              Id: id,
              Image: db.Image,
              RestartCount: 0,
              State: db.State,
              Config: {
                Labels: {
                  'com.docker.compose.project': container.project,
                  'com.docker.compose.service': container.service,
                  'com.docker.compose.container-number': '1',
                  'com.docker.compose.oneoff': 'False',
                },
                Env: container.env ?? [],
              },
            };
          }),
        );
      }
      return ok('');
    },
  };
}
const PROJECTS = ['tale', 'tale-blue', 'tale-green'];
const one = (role: string, project = 'tale-blue', id = '1'): Installed => ({
  id: id.repeat(64),
  project,
  service: 'platform',
  env: [BUNDLED, `TALE_ROLE=${role}`],
});
const web = (project = 'tale-blue', id = '7'): Installed => ({
  id: id.repeat(64),
  project,
  service: 'platform',
  // The web tier names no role and holds no database connection.
  env: ['PATH=/usr/local/bin'],
});
const backend = (
  service: 'backend-api' | 'backend-worker',
  project = 'tale-blue',
): Installed => ({
  id: (service === 'backend-api' ? 'c' : 'd').repeat(64),
  project,
  service,
  env: [BUNDLED],
});

test('one process that is the API and the jobs is a complete writer inventory', async () => {
  const census = await bundledBackendIdentity(
    PROJECTS,
    installed([one('all')]),
  );
  expect(
    census.writers.map(({ service, project }) => [service, project]),
  ).toEqual([['platform', 'tale-blue']]);
  expect(census.protocol).toBe(1);
  expect(
    (
      await bundledBackendIdentity(
        PROJECTS,
        installed([one('all')], { [AUTOMATION_PROTOCOL_LABEL]: '2' }),
      )
    ).protocol,
  ).toBe(2);
});

test('a platform that runs no jobs needs its worker beside it', async () => {
  await expect(
    bundledBackendIdentity(PROJECTS, installed([one('api')])),
  ).rejects.toThrow('inventory is incomplete');
  const census = await bundledBackendIdentity(
    PROJECTS,
    installed([one('api'), backend('backend-worker')]),
  );
  expect(census.writers.map((writer) => writer.service).toSorted()).toEqual([
    'backend-worker',
    'platform',
  ]);
});

test('the web tier of a colour of three services is no writer, and changes nothing the census compares', async () => {
  const backends = [backend('backend-api'), backend('backend-worker')];
  const alone = await bundledBackendIdentity(PROJECTS, installed(backends));
  const beside = await bundledBackendIdentity(
    PROJECTS,
    installed([web(), ...backends]),
  );
  expect(beside.writers).toEqual(alone.writers);
  expect(beside.identity).toBe(alone.identity);
  // Nor does it stand in for a backend that is missing.
  await expect(
    bundledBackendIdentity(
      PROJECTS,
      installed([web(), backend('backend-worker')]),
    ),
  ).rejects.toThrow('inventory is incomplete');
  await expect(
    bundledBackendIdentity(PROJECTS, installed([web()])),
  ).rejects.toThrow('connection is unknown');
  // An explicit web role is the web tier as well, and a role no shape gives
  // platform makes it no writer either.
  for (const role of ['web', 'worker'])
    await expect(
      bundledBackendIdentity(PROJECTS, installed([one(role)])),
    ).rejects.toThrow('connection is unknown');
});

test('the platforms are asked their role first and on their own, and only writers are read in full', async () => {
  const host = installed([
    web(),
    backend('backend-api'),
    backend('backend-worker'),
  ]);
  await bundledBackendIdentity(PROJECTS, host);
  // The web tier never joins the read of the writers, which stays the size
  // it was for a colour of three services.
  expect(host.inspected).toEqual([
    ['7'.repeat(64)],
    ['c'.repeat(64), 'd'.repeat(64)],
  ]);
  // Mid-flip onto one process: the old colour's web tier, the new colour's
  // whole application.
  const flipping = installed([
    { ...web(), id: '8'.repeat(64) },
    one('all', 'tale-green'),
  ]);
  await bundledBackendIdentity(PROJECTS, flipping);
  expect(flipping.inspected).toEqual([
    ['8'.repeat(64), '1'.repeat(64)],
    ['1'.repeat(64)],
  ]);
});

test('nothing in the record of a web tier can refuse the census', async () => {
  const backends = [backend('backend-api'), backend('backend-worker')];
  const plain = await bundledBackendIdentity(PROJECTS, installed(backends));
  // No environment at all, and one far past what a writer may carry.
  for (const env of [
    null,
    Array.from({ length: 4000 }, (_, index) => `VARIABLE_${index}=x`),
  ]) {
    const host = installed([web(), ...backends]);
    const exec = host.exec!;
    const census = await bundledBackendIdentity(PROJECTS, {
      exec: async (command, args, options) => {
        const answer = await exec(command, args, options);
        if (
          args[0] !== 'container' ||
          args[1] !== 'inspect' ||
          args[2] !== '7'.repeat(64)
        )
          return answer;
        const [record] = JSON.parse(answer.stdout) as Array<{
          Config: { Env: unknown };
        }>;
        if (record === undefined) throw new Error('no record');
        record.Config.Env = env;
        return { ...answer, stdout: JSON.stringify([record]) };
      },
    });
    expect(census.identity).toBe(plain.identity);
  }
});

test('while two colours of two shapes overlap, the writers of both are counted', async () => {
  const census = await bundledBackendIdentity(
    PROJECTS,
    installed([
      web('tale-blue'),
      backend('backend-api'),
      backend('backend-worker'),
      one('all', 'tale-green', '2'),
    ]),
  );
  expect(
    census.writers
      .map(({ project, service }) => `${project}/${service}`)
      .toSorted(),
  ).toEqual([
    'tale-blue/backend-api',
    'tale-blue/backend-worker',
    'tale-green/platform',
  ]);
});

test('a platform that is a writer is held to the bundled database like any backend', async () => {
  const external: Installed = {
    ...one('all'),
    env: [
      'DATABASE_URL=postgresql://tale:synthetic@external.invalid:5432/tale_app',
      'TALE_ROLE=all',
    ],
  };
  await expect(
    bundledBackendIdentity(PROJECTS, installed([external])),
  ).rejects.toThrow('Custom database');
  // The web tier carries the same `.env`, and is not judged by it.
  const census = await bundledBackendIdentity(
    PROJECTS,
    installed([
      { ...web(), env: [external.env?.[0] ?? ''] },
      backend('backend-api'),
      backend('backend-worker'),
    ]),
  );
  expect(census.writers).toHaveLength(2);
});

test('a deploy over one process reads the installed protocol through it', async () => {
  const host = installed([one('all')]);
  const deps: RuntimeDependencies = {
    exec: async (command, args, options) => {
      if (args[0] === 'exec') return ok({ schema: 'tale', ids });
      if (args[0] === 'container' && args[2] === db.Id) return ok([db]);
      return host.exec!(command, args, options);
    },
  };
  expect(await tagDeploymentProtocol('tale', true, deps)).toBe(2);
});
