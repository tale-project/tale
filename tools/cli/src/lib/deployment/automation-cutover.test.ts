import { afterEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  cutoverLegacyAutomation,
  LEGACY_CUTOVER_LEDGER_SHA256,
  LEGACY_CUTOVER_REVISION,
  requireEmptyLegacyCensus,
} from './automation-cutover';
import { AUTOMATION_PROTOCOL_LABEL } from './automation-model';
import { hash, type RuntimeDependencies } from './runtime-model';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const ledger = readdirSync(
  new URL(
    '../../../../../services/platform/backend/db/migrations/',
    import.meta.url,
  ),
)
  .filter(
    (name) =>
      /^\d{4}_.*\.(sql|ts)$/.test(name) && Number(name.slice(0, 4)) <= 153,
  )
  .sort();
const census = (unfinished = false) =>
  JSON.stringify({ schema: 'tale', ids: ledger }) +
  '\n' +
  JSON.stringify({ safeTable: true, unfinished, owned: true });
const ok = (value: unknown) => ({
  success: true,
  exitCode: 0,
  stdout: typeof value === 'string' ? value : JSON.stringify(value),
  stderr: '',
});

function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'tale-cutover-test-'));
  directories.push(stateDirectory);
  mkdirSync(join(stateDirectory, '.tale'));
  const labels = (service: string) => ({
    'com.docker.compose.project': 'example',
    'com.docker.compose.service': service,
    'com.docker.compose.container-number': '1',
    'com.docker.compose.oneoff': 'False',
  });
  const database = {
    Id: 'a'.repeat(64),
    Image: `sha256:${'b'.repeat(64)}`,
    RestartCount: 0,
    Config: { Image: 'synthetic-db', Labels: labels('db') },
    State: { Running: true, StartedAt: '2026-10-08T00:00:00Z' },
  };
  const writers = ['backend-api', 'backend-worker'].map((service, index) => ({
    Id: (index ? 'd' : 'c').repeat(64),
    Image: `sha256:${'e'.repeat(64)}`,
    RestartCount: 0,
    State: {
      Running: true,
      StartedAt: '2026-10-08T00:00:00Z',
      Pid: index + 1000,
      Status: 'running',
      Dead: false,
    },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    Config: {
      Labels: labels(service),
      Env: [
        'DATABASE_URL=postgresql://synthetic:unused@db:5432/tale_app',
        'SECRET=must-not-escape',
      ],
    },
  }));
  const events: string[] = [];
  let healthy = true;
  let revision = LEGACY_CUTOVER_REVISION;
  let unfinished = false;
  let onStop: (() => void) | undefined;
  let onAcquire: (() => void) | undefined;
  let installed = 1;
  let sourceProtocol = 1;
  const targetId = `sha256:${'7'.repeat(64)}`;
  const targetReference = `ghcr.io/tale-project/tale/tale-platform@sha256:${'6'.repeat(64)}`;
  const dependencies: RuntimeDependencies = {
    exec: async (_command, args) => {
      if (args[0] === 'ps')
        return ok(
          args.includes('label=com.docker.compose.project=example')
            ? writers
                .map(
                  (w) =>
                    `${w.Id}\t${w.Config.Labels['com.docker.compose.service']}`,
                )
                .join('\n')
            : '',
        );
      if (args[0] === 'image')
        return ok(
          args.slice(2).map((reference) => {
            const Id = reference === targetReference ? targetId : reference;
            return {
              Id,
              RepoDigests: Id === targetId ? [targetReference] : [],
              Config: {
                Labels: {
                  'org.opencontainers.image.revision':
                    Id === targetId ? options.targetRevision : revision,
                  [AUTOMATION_PROTOCOL_LABEL]:
                    Id === targetId ? '2' : String(sourceProtocol),
                },
              },
            };
          }),
        );
      if (args[0] === 'container')
        return ok(
          args[2] === database.Id
            ? [database]
            : writers.filter((w) => args.includes(w.Id)),
        );
      if (args[0] === 'exec')
        return ok({
          schema: 'tale',
          ids:
            installed === 2
              ? [...ledger, '0163_automation_legacy_protocol.sql']
              : ledger,
        });
      if (args[0] === 'stop') {
        events.push('stop');
        expect(args).toEqual([
          'stop',
          '--time=-1',
          ...writers.filter((w) => w.State.Running).map((w) => w.Id),
        ]);
        expect(events.includes('acquire')).toBe(true);
        expect(
          JSON.parse(
            readFileSync(
              join(stateDirectory, '.tale/automation-cutover.json'),
              'utf8',
            ),
          ).phase,
        ).toBe('stopping');
        onStop?.();
        for (const writer of writers)
          Object.assign(writer.State, {
            Running: false,
            Pid: 0,
            Status: 'exited',
          });
        return ok('');
      }
      throw new Error('Unexpected fixture command');
    },
    automationSession: async () => ({
      healthy: () => healthy,
      query: async (sql) => {
        if (!healthy) throw new Error('synthetic secret must not escape');
        if (sql === AUTOMATION_CUTOVER_ACQUIRE_SQL) {
          events.push('acquire');
          onAcquire?.();
          return census(unfinished);
        }
        expect(sql).toBe(AUTOMATION_CUTOVER_PROBE_SQL);
        events.push('probe');
        return '{"owned":true}';
      },
      close: async () => {
        events.push('close');
      },
    }),
  };
  const options = {
    databaseId: database.Id,
    project: 'example',
    stateDirectory,
    targetRevision: 'f'.repeat(40),
    targetBackendImages: [targetReference],
  };
  return {
    options,
    dependencies,
    events,
    writers,
    database,
    receipt: () =>
      JSON.parse(
        readFileSync(
          join(stateDirectory, '.tale/automation-cutover.json'),
          'utf8',
        ),
      ),
    run: () => cutoverLegacyAutomation(options, dependencies),
    lose: () => {
      healthy = false;
    },
    reconnect: () => {
      healthy = true;
    },
    busy: () => {
      unfinished = true;
    },
    wrongSource: () => {
      revision = '0'.repeat(40);
    },
    protocol: (floor: number, image: number) => {
      installed = floor;
      sourceProtocol = image;
    },
    replaceWithTargetWriters: (indices = [0, 1]) => {
      writers.forEach((writer, index) => {
        if (!indices.includes(index)) return;
        writer.Id = (index ? '8' : '9').repeat(64);
        writer.Image = targetId;
        Object.assign(writer.State, {
          Running: true,
          Pid: index + 2000,
          Status: 'running',
        });
      });
    },
    onStop: (hook: () => void) => {
      onStop = hook;
    },
    onAcquire: (hook: () => void) => {
      onAcquire = hook;
    },
  };
}

test('supported census binds all 152 immutable legacy migration names', () => {
  expect(ledger.length).toBe(152);
  expect(hash(JSON.stringify(ledger))).toBe(LEGACY_CUTOVER_LEDGER_SHA256);
  expect(() => requireEmptyLegacyCensus(census())).not.toThrow();
  for (const raw of [
    '',
    census(true),
    census().replace('"safeTable":true', '"safeTable":false'),
    census().replace('"owned":true', '"owned":false'),
    census().replace('0153_', '0154_'),
    census().replace('"tale"', '"public"'),
  ])
    expect(() => requireEmptyLegacyCensus(raw)).toThrow('zero unfinished');
});

test('held zero, durable identity, exact graceful stop and stopped readback precede lock release', async () => {
  const f = fixture();
  await f.run();
  expect(f.events[0]).toBe('acquire');
  expect(f.events.at(-1)).toBe('close');
  expect(f.events.indexOf('stop')).toBeGreaterThan(f.events.indexOf('probe'));
  expect(f.writers.every((w) => !w.State.Running)).toBe(true);
  expect(f.receipt().phase).toBe('stopped');
  expect(JSON.stringify(f.receipt())).not.toContain('unused');
  expect(JSON.stringify(f.receipt())).not.toContain('SECRET');
});

test('nonzero all-org census refuses before journal or stop', async () => {
  const f = fixture();
  f.busy();
  await expect(f.run()).rejects.toThrow('zero unfinished');
  expect(f.events).toEqual(['acquire', 'close']);
  expect(
    existsSync(join(f.options.stateDirectory, '.tale/automation-cutover.json')),
  ).toBe(false);
});

test('unsupported source, restart policy and external database refuse before lock or stop', async () => {
  for (const kind of ['source', 'restart', 'database'] as const) {
    const f = fixture();
    if (kind === 'source') f.wrongSource();
    if (kind === 'restart')
      f.writers[0].HostConfig.RestartPolicy.Name = 'always';
    if (kind === 'database')
      f.writers[0].Config.Env[0] =
        'DATABASE_URL=postgresql://synthetic@external:5432/tale_app';
    await expect(f.run()).rejects.toThrow();
    expect(f.events).toEqual([]);
  }
});

test('container or DB incarnation drift after census refuses before stopping', async () => {
  for (const kind of ['writer', 'database'] as const) {
    const f = fixture();
    f.onAcquire(() => {
      if (kind === 'writer') f.writers[0].RestartCount++;
      else f.database.RestartCount++;
    });
    await expect(f.run()).rejects.toThrow('identities changed');
    expect(f.events).toEqual(['acquire', 'close']);
  }
});

test('lost lock during stop leaves pending recovery and never admits startup', async () => {
  const f = fixture();
  f.onStop(f.lose);
  await expect(f.run()).rejects.toThrow('lock was lost');
  expect(f.receipt().phase).toBe('stopping');
  f.reconnect();
  f.onStop(() => {});
  f.events.length = 0;
  await f.run();
  expect(f.events[0]).toBe('acquire');
  expect(f.events).not.toContain('stop');
  expect(f.receipt().phase).toBe('stopped');
});

test('uncertain graceful stop is recoverable only after a fresh held census', async () => {
  const f = fixture();
  f.onStop(() => {
    Object.assign(f.writers[0].State, {
      Running: false,
      Pid: 0,
      Status: 'exited',
    });
    throw new Error('stop interrupted');
  });
  await expect(f.run()).rejects.toThrow('could not complete');
  expect(f.receipt().phase).toBe('stopping');
  f.onStop(() => {});
  f.busy();
  f.events.length = 0;
  await expect(f.run()).rejects.toThrow('zero unfinished');
  expect(f.events).toEqual(['acquire', 'close']);
});

test('restart or target drift cannot reuse a prior stopped receipt', async () => {
  for (const kind of ['restart', 'target'] as const) {
    const f = fixture();
    await f.run();
    f.events.length = 0;
    if (kind === 'restart') f.writers[0].RestartCount++;
    else f.options.targetRevision = '0'.repeat(40);
    await expect(f.run()).rejects.toThrow('recovery identities changed');
    expect(f.events).toEqual([]);
  }
});

test('same-protocol upgrade does not take a legacy lock', async () => {
  const f = fixture();
  f.protocol(2, 2);
  await f.run();
  expect(f.events).toEqual([]);
});

test('created new writers can resume only the exact recorded stopped-writer handoff', async () => {
  const absent = fixture();
  absent.protocol(1, 2);
  await expect(absent.run()).rejects.toThrow('recovery receipt');
  expect(absent.events).toEqual([]);
  const f = fixture();
  await f.run();
  f.events.length = 0;
  f.replaceWithTargetWriters();
  await f.run();
  expect(f.events).toEqual([]);
  f.options.targetRevision = '0'.repeat(40);
  await expect(f.run()).rejects.toThrow('stopped-writer handoff');
});

test('partial Compose replacement resumes only with retained exact stopped legacy writers', async () => {
  const f = fixture();
  await f.run();
  f.events.length = 0;
  f.replaceWithTargetWriters([0]);
  await f.run();
  expect(f.events).toEqual([]);
  f.writers[1].State.Running = true;
  f.writers[1].State.Pid = 1234;
  f.writers[1].State.Status = 'running';
  await expect(f.run()).rejects.toThrow('stopped-writer handoff');
  expect(f.events).toEqual([]);
});
