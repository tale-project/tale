import { afterEach, expect, spyOn, test } from 'bun:test';
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

import * as logger from '../../utils/logger';
import {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  cutoverLegacyAutomation,
  LEGACY_CUTOVER_LEDGER_SHA256,
  LEGACY_CUTOVER_REVISION,
  requireEmptyLegacyCensus,
} from './automation-cutover';
import {
  AUTOMATION_CUTOVER_READINESS_SQL,
  legacyCutoverBusy,
  legacyLedgerShape,
} from './automation-cutover-sql';
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
const census = (unfinished = false, ids: readonly string[] = ledger) =>
  JSON.stringify({ schema: 'tale', ids }) +
  '\n' +
  JSON.stringify({ safeTable: true, unfinished, owned: true });
/** What a first protocol-2 boot cut before 0163 leaves: v0.5.77's ledger and
 * some of the migrations after it. */
const continued = [
  ...ledger,
  ...readdirSync(
    new URL(
      '../../../../../services/platform/backend/db/migrations/',
      import.meta.url,
    ),
  )
    .filter(
      (name) =>
        /^\d{4}_.*\.(sql|ts)$/.test(name) &&
        Number(name.slice(0, 4)) >= 154 &&
        Number(name.slice(0, 4)) <= 162,
    )
    .sort(),
];
const ok = (value: unknown) => ({
  success: true,
  exitCode: 0,
  stdout: typeof value === 'string' ? value : JSON.stringify(value),
  stderr: '',
});

function fixture(
  shape: {
    /** Where the legacy writers run: `example-blue` is `tale deploy`'s. */
    writerProject?: string;
    /** Run as `tale deploy` does, with the workspace scope. */
    workspace?: boolean;
    registry?: string;
  } = {},
) {
  const writerProject = shape.writerProject ?? 'example';
  const registry = shape.registry ?? 'ghcr.io/tale-project/tale';
  const stateDirectory = mkdtempSync(join(tmpdir(), 'tale-cutover-test-'));
  directories.push(stateDirectory);
  mkdirSync(join(stateDirectory, '.tale'));
  const labels = (service: string, project = 'example') => ({
    'com.docker.compose.project': project,
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
      Labels: labels(service, writerProject),
      Env: [
        'DATABASE_URL=postgresql://synthetic:unused@db:5432/tale_app',
        'SECRET=must-not-escape',
      ],
    },
  }));
  const events: string[] = [];
  const sessionRetries: (string | undefined)[] = [];
  let ledgerIds: readonly string[] = ledger;
  let healthy = true;
  let revision = LEGACY_CUTOVER_REVISION;
  let unfinished = false;
  let onStop: (() => void) | undefined;
  let onAcquire: (() => void) | undefined;
  let installed = 1;
  let sourceProtocol = 1;
  const targetId = `sha256:${'7'.repeat(64)}`;
  const targetReference = `${registry}/tale-platform@sha256:${'6'.repeat(64)}`;
  const dependencies: RuntimeDependencies = {
    exec: async (_command, args) => {
      if (args[0] === 'ps') {
        const project = args
          .find((arg) => arg.startsWith('label=com.docker.compose.project='))
          ?.slice('label=com.docker.compose.project='.length);
        return ok(
          writers
            .filter(
              (w) => w.Config.Labels['com.docker.compose.project'] === project,
            )
            .map(
              (w) =>
                `${w.Id}\t${w.Config.Labels['com.docker.compose.service']}`,
            )
            .join('\n'),
        );
      }
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
              ? [...ledgerIds, '0163_automation_legacy_protocol.sql']
              : ledgerIds,
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
    automationSession: async (_container, retry) => {
      sessionRetries.push(retry);
      return {
        healthy: () => healthy,
        query: async (sql) => {
          if (!healthy) throw new Error('synthetic secret must not escape');
          if (sql === AUTOMATION_CUTOVER_ACQUIRE_SQL) {
            events.push('acquire');
            onAcquire?.();
            return census(unfinished, ledgerIds);
          }
          expect(sql).toBe(AUTOMATION_CUTOVER_PROBE_SQL);
          events.push('probe');
          return '{"owned":true}';
        },
        close: async () => {
          events.push('close');
        },
      };
    },
  };
  const options: Parameters<typeof cutoverLegacyAutomation>[0] = {
    databaseId: database.Id,
    project: 'example',
    stateDirectory,
    targetRevision: 'f'.repeat(40),
    targetBackendImages: [targetReference],
    ...(shape.workspace
      ? {
          workspace: {
            writerProjects: ['example', 'example-blue', 'example-green'],
            targetProjects: ['example-blue', 'example-green'],
            targetRepository: `${registry}/tale-platform`,
          },
        }
      : {}),
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
    /** Compose created the new colour's writers on the admitted image. */
    addTargetWriters: (project: string) => {
      ['backend-api', 'backend-worker'].forEach((service, index) =>
        writers.push({
          Id: (index ? '4' : '5').repeat(64),
          Image: targetId,
          RestartCount: 0,
          State: {
            Running: true,
            StartedAt: '2026-10-08T00:05:00Z',
            Pid: index + 3000,
            Status: 'running',
            Dead: false,
          },
          HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
          Config: {
            Labels: labels(service, project),
            Env: [
              'DATABASE_URL=postgresql://synthetic:unused@db:5432/tale_app',
            ],
          },
        }),
      );
    },
    /** Someone started an old writer again. */
    restart: (index: number) => {
      Object.assign(writers[index].State, {
        Running: true,
        Pid: 4321,
        Status: 'running',
      });
    },
    /** A rollback or an older CLI created fresh v0.5.77 writers. */
    recreateLegacyWriters: () => {
      writers.forEach((writer, index) => {
        writer.Id = (index ? '3' : '2').repeat(64);
        Object.assign(writer.State, {
          Running: true,
          Pid: index + 5000,
          Status: 'running',
        });
      });
    },
    setLedger: (ids: readonly string[]) => {
      ledgerIds = ids;
    },
    sessionRetries,
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
  expect(() =>
    requireEmptyLegacyCensus(census().replace('"tale"', '"public"')),
  ).not.toThrow();
  for (const raw of [
    '',
    census(true),
    census().replace('"safeTable":true', '"safeTable":false'),
    census().replace('"owned":true', '"owned":false'),
    census().replace('0153_', '0154_'),
    census().replace('"tale"', '"unrecognized"'),
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
  await expect(f.run()).rejects.toThrow('Automation cutover is pending');
  expect(f.receipt().phase).toBe('stopping');
  f.onStop(() => {});
  f.busy();
  f.events.length = 0;
  await expect(f.run()).rejects.toThrow('zero unfinished');
  expect(f.events).toEqual(['acquire', 'close']);
});

test('partial stop failure gives redacted recovery guidance after a progress notice', async () => {
  for (const kind of ['throw', 'unsuccessful'] as const) {
    const f = fixture();
    const progress = spyOn(logger, 'info').mockImplementation(() => {});
    const original = f.dependencies.exec!;
    f.dependencies.exec = async (command, args, options) => {
      if (args[0] !== 'stop') return original(command, args, options);
      expect(progress).toHaveBeenCalledWith(
        'Automation cutover: holding admission while gracefully stopping legacy backend writers (up to 60 seconds).',
      );
      expect(f.receipt().phase).toBe('stopping');
      Object.assign(f.writers[0].State, {
        Running: false,
        Pid: 0,
        Status: 'exited',
      });
      if (kind === 'throw') throw new Error('private Docker exception');
      return {
        success: false,
        exitCode: 1,
        stdout: 'private Docker output',
        stderr: 'private Docker error',
      };
    };
    try {
      const failure = await f.run().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain('Automation cutover is pending');
      expect(message).toContain('Keep the deployment bundle');
      expect(message).toContain('.tale/automation-cutover.json receipt');
      expect(message).toContain('retry the same managed deployment');
      expect(message).toContain('Do not manually restart containers');
      expect(message).not.toContain('private Docker');
      expect(f.receipt().phase).toBe('stopping');
      expect(f.writers[0].State.Running).toBe(false);
      expect(f.writers[1].State.Running).toBe(true);
      expect(f.events.at(-1)).toBe('close');
    } finally {
      progress.mockRestore();
    }
  }
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

test('the readiness census reads without the lock and refuses an unreadable answer', () => {
  expect(AUTOMATION_CUTOVER_READINESS_SQL).toContain('READ ONLY');
  expect(AUTOMATION_CUTOVER_READINESS_SQL).not.toContain('LOCK TABLE');
  expect(AUTOMATION_CUTOVER_READINESS_SQL.trim().endsWith('ROLLBACK;')).toBe(
    true,
  );
  expect(
    legacyCutoverBusy('{"safeTable":true,"unfinished":false,"owned":false}'),
  ).toBe(false);
  expect(
    legacyCutoverBusy('{"safeTable":true,"unfinished":true,"owned":false}\n'),
  ).toBe(true);
  for (const raw of [
    '',
    'not json',
    '{"safeTable":false,"unfinished":false,"owned":false}',
    '{"safeTable":true,"owned":false}',
  ])
    expect(() => legacyCutoverBusy(raw)).toThrow();
});

test('a ledger without 0163 is v0.5.77, v0.5.77 continued by a cut first boot, or neither', () => {
  expect(continued.length).toBeGreaterThan(ledger.length);
  expect(legacyLedgerShape(ledger)).toBe('legacy');
  expect(legacyLedgerShape(continued)).toBe('continued');
  expect(legacyLedgerShape(ledger.slice(1))).toBe('unsupported');
  expect(legacyLedgerShape(ledger.slice(0, -1))).toBe('unsupported');
  expect(legacyLedgerShape([])).toBe('unsupported');
});

test('managed apply still refuses writers in colour projects before any lock', async () => {
  const f = fixture({ writerProject: 'example-blue' });
  await expect(f.run()).rejects.toThrow(
    'blue/green writers are outside its custody',
  );
  expect(f.events).toEqual([]);
  expect(f.writers.every((w) => w.State.Running)).toBe(true);
});

test('tale deploy cuts over a v0.5.77 workspace whose writers run in a colour project', async () => {
  const f = fixture({ writerProject: 'example-blue', workspace: true });
  await f.run();
  expect(f.events[0]).toBe('acquire');
  expect(f.events.indexOf('stop')).toBeGreaterThan(f.events.indexOf('probe'));
  expect(f.events.at(-1)).toBe('close');
  expect(f.writers.every((w) => !w.State.Running)).toBe(true);
  expect(f.receipt().phase).toBe('stopped');
  expect(
    f.receipt().writers.map((w: { project: string }) => w.project),
  ).toEqual(['example-blue', 'example-blue']);
  expect(f.sessionRetries).toEqual(['run `tale deploy` again']);
});

test('a backend singleton from before the colours is in a workspace cutover too', async () => {
  const f = fixture({ writerProject: 'example', workspace: true });
  await f.run();
  expect(f.writers.every((w) => !w.State.Running)).toBe(true);
  expect(f.receipt().phase).toBe('stopped');
});

test('a workspace resumes only onto target writers in a colour project', async () => {
  const f = fixture({ writerProject: 'example-blue', workspace: true });
  await f.run();
  f.events.length = 0;
  f.addTargetWriters('example-green');
  await f.run();
  expect(f.events).toEqual([]);

  const outside = fixture({ writerProject: 'example-blue', workspace: true });
  await outside.run();
  outside.events.length = 0;
  outside.addTargetWriters('example');
  await expect(outside.run()).rejects.toThrow(
    'do not match its stopped handoff',
  );
  expect(outside.events).toEqual([]);

  const restarted = fixture({ writerProject: 'example-blue', workspace: true });
  await restarted.run();
  restarted.events.length = 0;
  restarted.addTargetWriters('example-green');
  restarted.restart(0);
  await expect(restarted.run()).rejects.toThrow(
    'do not match its stopped handoff',
  );
});

test('a first boot cut before 0163 resumes the exact recorded handoff without a census', async () => {
  const f = fixture({ writerProject: 'example-blue', workspace: true });
  await f.run();
  f.events.length = 0;
  f.setLedger(continued);
  await f.run();
  expect(f.events).toEqual([]);
  f.restart(1);
  await expect(f.run()).rejects.toThrow('started upgrading this database');
  expect(f.events).toEqual([]);

  const otherRelease = fixture({
    writerProject: 'example-blue',
    workspace: true,
  });
  await otherRelease.run();
  otherRelease.setLedger(continued);
  otherRelease.options.targetRevision = '0'.repeat(40);
  await expect(otherRelease.run()).rejects.toThrow(
    'started upgrading this database',
  );

  const noReceipt = fixture({ writerProject: 'example-blue', workspace: true });
  noReceipt.setLedger(continued);
  await expect(noReceipt.run()).rejects.toThrow(
    'started upgrading this database',
  );
  expect(noReceipt.events).toEqual([]);
  expect(noReceipt.writers.every((w) => w.State.Running)).toBe(true);

  // Managed apply keeps its census, which a continued ledger cannot pass.
  const managed = fixture();
  await managed.run();
  managed.events.length = 0;
  managed.setLedger(continued);
  await expect(managed.run()).rejects.toThrow('zero unfinished');
});

test('a workspace takes a fresh census over an earlier attempt that changed nothing', async () => {
  const f = fixture({ writerProject: 'example-blue', workspace: true });
  await f.run();
  f.events.length = 0;
  f.recreateLegacyWriters();
  await f.run();
  expect(f.events[0]).toBe('acquire');
  expect(f.events).toContain('stop');
  expect(f.writers.every((w) => !w.State.Running)).toBe(true);
  expect(f.receipt().writers.map((w: { id: string }) => w.id)).toEqual(
    f.writers.map((w) => w.Id),
  );

  const managed = fixture();
  await managed.run();
  managed.events.length = 0;
  managed.recreateLegacyWriters();
  await expect(managed.run()).rejects.toThrow('recovery identities changed');
});

test('a workspace refuses what it cannot cut over, names the way forward and stops nothing', async () => {
  for (const [kind, words] of [
    ['source', 'tale update -v 0.5.77'],
    ['restart', 'unless-stopped'],
    ['ledger', 'tale update -v 0.5.77'],
  ] as const) {
    const f = fixture({ writerProject: 'example-blue', workspace: true });
    if (kind === 'source') f.wrongSource();
    if (kind === 'restart')
      f.writers[0].HostConfig.RestartPolicy.Name = 'always';
    if (kind === 'ledger') f.setLedger(ledger.slice(1));
    const failure = await f.run().catch((error: unknown) => error);
    expect((failure as Error).message).toContain(words);
    expect((failure as Error).message).toContain('Nothing was changed');
    expect(f.events).toEqual([]);
    expect(f.writers.every((w) => w.State.Running)).toBe(true);
  }
});

test('a busy workspace census stops nothing and says what to do', async () => {
  const f = fixture({ writerProject: 'example-blue', workspace: true });
  f.busy();
  await expect(f.run()).rejects.toThrow('let the runs finish or cancel them');
  expect(f.events).toEqual(['acquire', 'close']);
  expect(f.writers.every((w) => w.State.Running)).toBe(true);
  expect(
    existsSync(join(f.options.stateDirectory, '.tale/automation-cutover.json')),
  ).toBe(false);
});

test('a workspace stop cut short says to run tale deploy again, not a managed bundle', async () => {
  const f = fixture({ writerProject: 'example-blue', workspace: true });
  f.onStop(() => {
    throw new Error('stop interrupted');
  });
  const failure = await f.run().catch((error: unknown) => error);
  const message = (failure as Error).message;
  expect(message).toContain('Automation cutover is pending');
  expect(message).toContain('run `tale deploy` again');
  expect(message).toContain('Do not manually restart containers');
  expect(message).not.toContain('managed');
  expect(message).not.toContain('bundle');
  expect(f.receipt().phase).toBe('stopping');
});

test('a workspace resumes onto the digest of its own registry only', async () => {
  const f = fixture({
    writerProject: 'example-blue',
    workspace: true,
    registry: 'registry.example.com/mirror',
  });
  await f.run();
  f.events.length = 0;
  f.addTargetWriters('example-green');
  await f.run();
  expect(f.events).toEqual([]);
  f.options.targetBackendImages = [
    `ghcr.io/tale-project/tale/tale-platform@sha256:${'6'.repeat(64)}`,
  ];
  await expect(f.run()).rejects.toThrow(
    'exact prepared backend image references',
  );
});
