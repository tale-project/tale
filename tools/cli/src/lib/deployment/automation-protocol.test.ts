import { afterEach, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

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
