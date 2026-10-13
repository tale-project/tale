import { afterEach, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { colorProject } from '../actions/color-lifecycle';
import { ROTATABLE_SERVICES } from '../compose/types';
import { setProjectId } from '../project/project-context';
import {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  LEGACY_CUTOVER_REVISION,
} from './automation-cutover';
import { AUTOMATION_CUTOVER_READINESS_SQL } from './automation-cutover-sql';
import { AUTOMATION_PROTOCOL_LABEL } from './automation-model';
import type { RuntimeDependencies } from './runtime-model';
import {
  assessTagAutomationCutover,
  CUTOVER_BUSY,
  planTagAutomationCutover,
  runTagAutomationCutover,
  workspaceCutoverScope,
} from './tag-automation-cutover';
import { admitTagAutomationImage } from './tag-automation-protocol';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const migrations = readdirSync(
  new URL(
    '../../../../../services/platform/backend/db/migrations/',
    import.meta.url,
  ),
)
  .filter((name) => /^\d{4}_.*\.(sql|ts)$/.test(name))
  .sort();
/** v0.5.77's ledger, as the released `public.app_migrations` holds it. */
const legacy = migrations.filter((name) => Number(name.slice(0, 4)) <= 153);
const ok = (value: unknown) => ({
  success: true,
  exitCode: 0,
  stdout: typeof value === 'string' ? value : JSON.stringify(value),
  stderr: '',
});
const config = { registry: 'ghcr.io/tale-project/tale', version: '0.5.89' };
const reference = `${config.registry}/tale-platform@sha256:${'6'.repeat(64)}`;
const target = {
  Id: `sha256:${'7'.repeat(64)}`,
  Os: 'linux',
  Architecture: 'amd64',
  RepoDigests: [reference],
  Config: {
    Labels: {
      [AUTOMATION_PROTOCOL_LABEL]: '2',
      'org.opencontainers.image.revision': 'f'.repeat(40),
      'org.opencontainers.image.version': config.version,
      'org.opencontainers.image.source': 'https://github.com/tale-project/tale',
    },
  },
};

/**
 * A Docker host as `tale deploy` v0.5.77 leaves it, read off a real one: the
 * database in the deployment's project, both backend roles in the live colour
 * (`<id>-blue`), `unless-stopped`, on an image whose source is b4931db4 and
 * which carries no writer protocol label; the ledger is v0.5.77's 152 names.
 */
function workspaceHost() {
  const labels = (project: string, service: string) => ({
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
    'com.docker.compose.container-number': '1',
    'com.docker.compose.oneoff': 'False',
  });
  const database = {
    Id: 'a'.repeat(64),
    Image: `sha256:${'b'.repeat(64)}`,
    RestartCount: 0,
    Config: { Image: 'tale-db:0.5.77', Labels: labels('example', 'db') },
    State: { Running: true, StartedAt: '2026-10-13T15:00:00Z' },
  };
  const legacyImage = `sha256:${'e'.repeat(64)}`;
  const writers = ['backend-api', 'backend-worker'].map((service, index) => ({
    Id: (index ? 'd' : 'c').repeat(64),
    Image: legacyImage,
    RestartCount: 0,
    State: {
      Running: true,
      StartedAt: '2026-10-13T15:00:00Z',
      Pid: index + 100,
      Status: 'running',
      Dead: false,
    },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    Config: {
      Labels: labels('example-blue', service),
      Env: ['DATABASE_URL=postgresql://tale:secret@db:5432/tale_app'],
    },
  }));
  const state = {
    ledger: legacy as readonly string[],
    unfinished: false,
    revision: LEGACY_CUTOVER_REVISION,
    census: 'readable' as 'readable' | 'unreadable',
  };
  const mutations: string[][] = [];
  const project = (args: string[]) =>
    args
      .find((arg) => arg.startsWith('label=com.docker.compose.project='))
      ?.slice('label=com.docker.compose.project='.length);
  const dependencies: RuntimeDependencies = {
    exec: async (_command, args, options) => {
      if (args[0] === 'ps') {
        if (args.includes('label=com.docker.compose.service=db'))
          return ok(project(args) === 'example' ? database.Id : '');
        return ok(
          writers
            .filter(
              (w) =>
                w.Config.Labels['com.docker.compose.project'] === project(args),
            )
            .map(
              (w) =>
                `${w.Id}\t${w.Config.Labels['com.docker.compose.service']}`,
            )
            .join('\n'),
        );
      }
      if (args[0] === 'container' && args[1] === 'inspect')
        return ok(
          args[2] === database.Id
            ? [database]
            : writers.filter((w) => args.includes(w.Id)),
        );
      if (args[0] === 'image' && args[1] === 'inspect')
        return ok(
          args.slice(2).map((image) =>
            image === legacyImage
              ? {
                  Id: legacyImage,
                  Config: {
                    Labels: {
                      'org.opencontainers.image.revision': state.revision,
                      'org.opencontainers.image.version': '0.5.77',
                    },
                  },
                }
              : target,
          ),
        );
      if (args[0] === 'exec') {
        const script = String(options?.stdin ?? '');
        if (script.includes(AUTOMATION_CUTOVER_READINESS_SQL)) {
          if (state.census === 'unreadable')
            return { success: false, exitCode: 3, stdout: '', stderr: 'x' };
          return ok({
            safeTable: true,
            unfinished: state.unfinished,
            owned: false,
          });
        }
        return ok({ schema: 'public', ids: state.ledger });
      }
      if (args[0] === 'stop') {
        mutations.push(args);
        for (const writer of writers)
          if (args.includes(writer.Id))
            Object.assign(writer.State, {
              Running: false,
              Pid: 0,
              Status: 'exited',
            });
        return ok('');
      }
      throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
    },
    automationSession: async () => ({
      healthy: () => true,
      query: async (sql) => {
        if (sql === AUTOMATION_CUTOVER_ACQUIRE_SQL)
          return (
            JSON.stringify({ schema: 'public', ids: state.ledger }) +
            '\n' +
            JSON.stringify({
              safeTable: true,
              unfinished: state.unfinished,
              owned: true,
            })
          );
        expect(sql).toBe(AUTOMATION_CUTOVER_PROBE_SQL);
        return '{"owned":true}';
      },
      close: async () => {},
    }),
  };
  return { database, writers, state, mutations, dependencies };
}

const plan = (host: ReturnType<typeof workspaceHost>) =>
  planTagAutomationCutover(
    {
      project: 'example',
      platformImage: reference,
      runningVersion: '0.5.77',
      release: '0.5.89',
    },
    host.dependencies,
  );

test('tale deploy admits the released v0.5.77 workspace layout it refused from v0.5.79 to v0.5.89', async () => {
  setProjectId('example');
  const host = workspaceHost();
  await expect(
    admitTagAutomationImage(config, 1, host.dependencies),
  ).rejects.toThrow('cutover barrier');
  expect(
    await admitTagAutomationImage(config, 1, host.dependencies, {
      legacyCutover: true,
    }),
  ).toBe(reference);
  expect(await plan(host)).toEqual({
    resume: false,
    platformImage: reference,
    targetRevision: 'f'.repeat(40),
  });
  expect(host.mutations).toEqual([]);
});

test('the workspace scope follows where tale deploy runs its backend writers', () => {
  setProjectId('example');
  expect(ROTATABLE_SERVICES).toEqual(
    expect.arrayContaining(['backend-api', 'backend-worker']),
  );
  const scope = workspaceCutoverScope('example', 'registry.example.com/tale');
  for (const color of ['blue', 'green'] as const) {
    expect(scope.writerProjects).toContain(colorProject(color));
    expect(scope.targetProjects).toContain(colorProject(color));
  }
  expect(scope.writerProjects).toContain('example');
  expect(scope.targetProjects).not.toContain('example');
  expect(scope.targetRepository).toBe(
    'registry.example.com/tale/tale-platform',
  );
});

test('nothing is crossed for a protocol-1 image, an empty host or a protocol-2 database', async () => {
  expect(
    await planTagAutomationCutover(
      { project: 'example', platformImage: undefined, runningVersion: null },
      workspaceHost().dependencies,
    ),
  ).toBeNull();

  const empty = workspaceHost();
  const emptyDependencies: RuntimeDependencies = {
    exec: async (command, args, options) =>
      args[0] === 'ps' && args.includes('label=com.docker.compose.service=db')
        ? ok('')
        : empty.dependencies.exec!(command, args, options),
  };
  expect(
    await planTagAutomationCutover(
      { project: 'example', platformImage: reference, runningVersion: null },
      emptyDependencies,
    ),
  ).toBeNull();

  const upgraded = workspaceHost();
  upgraded.state.ledger = [...legacy, '0163_automation_legacy_protocol.sql'];
  expect(await plan(upgraded)).toBeNull();
});

test('an interrupted cutover resumes: new writers created, or a first boot cut before 0163', async () => {
  const continued = workspaceHost();
  continued.state.ledger = migrations.filter(
    (name) => Number(name.slice(0, 4)) <= 160,
  );
  expect((await plan(continued))?.resume).toBe(true);

  const created = workspaceHost();
  created.writers.push({
    ...created.writers[0],
    Id: '9'.repeat(64),
    Image: target.Id,
    Config: {
      ...created.writers[0].Config,
      Labels: {
        ...created.writers[0].Config.Labels,
        'com.docker.compose.project': 'example-green',
      },
    },
  });
  expect((await plan(created))?.resume).toBe(true);
  expect(created.mutations).toEqual([]);
});

test('every refusal names the way forward, and nothing was changed', async () => {
  const cases: Array<
    [string, (host: ReturnType<typeof workspaceHost>) => void, string]
  > = [
    [
      'a host older than v0.5.77',
      (host) => {
        host.state.ledger = legacy.slice(0, -3);
        host.state.revision = '0'.repeat(40);
      },
      'tale update -v 0.5.77',
    ],
    [
      'a v0.5.77 schema under another build',
      (host) => {
        host.state.revision = '0'.repeat(40);
      },
      'tale update -v 0.5.77',
    ],
    [
      'a restart policy that would restart the old writers',
      (host) => {
        host.writers[1].HostConfig.RestartPolicy.Name = 'always';
      },
      'unless-stopped',
    ],
    [
      'unfinished automation runs',
      (host) => {
        host.state.unfinished = true;
      },
      'let them finish or cancel them',
    ],
    [
      'a census that cannot be read',
      (host) => {
        host.state.census = 'unreadable';
      },
      'run `tale deploy` again',
    ],
  ];
  for (const [label, arrange, words] of cases) {
    const host = workspaceHost();
    arrange(host);
    const failure = await plan(host).catch((error: unknown) => error);
    expect(failure, label).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message, label).toContain(words);
    expect(message, label).toContain('Nothing was changed');
    expect(message, label).not.toContain('managed deployment apply');
    expect(message, label).not.toContain('update --version');
    if (words.startsWith('tale update'))
      expect(message, label).toContain('tale update -v 0.5.89');
    expect(host.mutations, label).toEqual([]);
    expect(
      host.writers.every((w) => w.State.Running),
      label,
    ).toBe(true);
  }
  expect(CUTOVER_BUSY).toContain('tale deploy');
});

test('the dry-run assessment reads the same answer without an image', async () => {
  expect(
    await assessTagAutomationCutover(
      { project: 'example', runningVersion: '0.5.77' },
      workspaceHost().dependencies,
    ),
  ).toBe('ready');
  const busy = workspaceHost();
  busy.state.unfinished = true;
  await expect(
    assessTagAutomationCutover(
      { project: 'example', runningVersion: '0.5.77' },
      busy.dependencies,
    ),
  ).rejects.toThrow(CUTOVER_BUSY);
});

test('the barrier stops the live colour writers and keeps its receipt in the workspace', async () => {
  const host = workspaceHost();
  const deployDir = mkdtempSync(join(tmpdir(), 'tale-tag-cutover-'));
  directories.push(deployDir);
  mkdirSync(join(deployDir, '.tale'));
  const settled = await plan(host);
  expect(settled).not.toBeNull();
  await runTagAutomationCutover(
    {
      project: 'example',
      registry: config.registry,
      deployDir,
      plan: settled!,
    },
    host.dependencies,
  );
  expect(host.mutations).toEqual([
    ['stop', '--time=-1', 'c'.repeat(64), 'd'.repeat(64)],
  ]);
  expect(host.writers.every((w) => !w.State.Running)).toBe(true);
  const receipt = JSON.parse(
    readFileSync(join(deployDir, '.tale', 'automation-cutover.json'), 'utf8'),
  );
  expect(receipt.phase).toBe('stopped');
  expect(receipt.project).toBe('example');
  expect(JSON.stringify(receipt)).not.toContain('secret');
});
