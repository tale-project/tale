// Several Incus hosts behind one spawner: a new session goes to the host with
// the most headroom, a drained host takes none while its sessions carry on, a
// host that does not answer is skipped with its reason, and a session stays
// on the host it was created on. Each host is a fake Incus driven by the real
// per-host session backend.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { IncusApiError } from '@tale/incus/api';
import { IncusClient } from '@tale/incus/client';
import type { FakeIncus } from '@tale/incus/fake';

import { operationSignal } from '../../operation-budget.ts';
import type {
  IncusConfig,
  IncusEndpointConfig,
  SpawnerConfig,
} from '../../types.ts';
import {
  type HealthResult,
  type HostBackend,
  SessionPlacementError,
} from '../types.ts';
import { FakeRunnerd, fakeSessionIncus } from './fake-session-runtime.ts';
import { endpointView } from './incus-endpoints.ts';
import {
  type EndpointParts,
  IncusEndpointSet,
  isConnectionFailure,
  MultiIncusBackend,
  MultiIncusSessionBackend,
  UNREACHABLE_RETRY_MS,
} from './incus-multi-backend.ts';
import { incusWorkspaceVolumeName } from './incus-naming.ts';
import {
  MemoryPlacementStore,
  type PlacementRecord,
} from './incus-placement-record.ts';
import { readProjectRoom } from './incus-placement.ts';
import { IncusRuntime } from './incus-runtime.ts';
import { IncusSessionBackend } from './incus-session-backend.ts';
import { specOf, START_MS } from './incus-session-fixture.ts';
import { incusTestConfig } from './incus-test-config.ts';
import { rejection } from './incus-test-support.ts';

let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;
let error: ReturnType<typeof spyOn<typeof console, 'error'>>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
  log = spyOn(console, 'log').mockImplementation(() => undefined);
  error = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  log.mockRestore();
  error.mockRestore();
});

function warnings(): string[] {
  return warn.mock.calls.map((call) => call.map(String).join(' '));
}

interface HostOptions {
  maxSessions?: number;
  drained?: boolean;
  /** The project's `limits.memory`. */
  memory?: string;
  /** The host's boot checks fail with this. */
  initError?: string;
  /** Making its runtime image present fails with this. */
  imageError?: string;
}

/** Waits, or ends with the request's own abort (its timeout). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

interface TestHost {
  name: string;
  fake: FakeIncus;
  /** While true, every request to the host fails as a refused connection. */
  down: boolean;
  /** How long the host takes to answer each request. */
  latencyMs: number;
  /** While set, the host answers every request with this HTTP error. */
  failStatus: number | undefined;
  initError: string | undefined;
  imageError: string | undefined;
  /** How often its warm standbys were removed (a drained host). */
  retired: number;
  parts: EndpointParts;
}

const clock = { now: START_MS };

function entry(name: string, options: HostOptions): IncusEndpointConfig {
  return {
    name,
    endpoint: `https://${name}.test:8443`,
    clientCertFile: `/run/incus/${name}/client.crt`,
    clientKeyFile: `/run/incus/${name}/client.key`,
    serverCertFile: `/run/incus/${name}/server.crt`,
    project: 'sandbox-pr',
    profile: 'sandbox',
    network: 'sbx0',
    storagePool: 'tank',
    image: 'tale-sandbox-runtime',
    maxSessions: options.maxSessions ?? 10,
    poolSize: 0,
    egressProxy: 'http://10.9.0.2:3128',
    dns: ['10.9.0.2'],
    drained: options.drained ?? false,
  };
}

function makeHost(
  base: SpawnerConfig,
  name: string,
  options: HostOptions,
): TestHost {
  const fake = fakeSessionIncus();
  if (options.memory !== undefined) {
    fake.projectConfig = {
      ...fake.projectConfig,
      'limits.memory': options.memory,
    };
  }
  const runnerd = new FakeRunnerd(fake);
  const cfg = endpointView(base, entry(name, options));
  // What a test switches while the host runs.
  const host: Pick<
    TestHost,
    'down' | 'latencyMs' | 'failStatus' | 'initError' | 'imageError' | 'retired'
  > = {
    down: false,
    latencyMs: 0,
    failStatus: undefined,
    initError: options.initError,
    imageError: options.imageError,
    retired: 0,
  };
  const client = new IncusClient({
    endpoint: `https://${name}.test:8443`,
    project: 'sandbox-pr',
    tls: { ca: 'ca', cert: 'cert', key: 'key' },
    signal: () => operationSignal(),
    requestTimeoutMs: base.incus?.apiTimeoutMs,
    fetch: async (url, init) => {
      if (host.down) throw new TypeError(`connect ECONNREFUSED ${name}`);
      if (host.latencyMs > 0) await delay(host.latencyMs, init.signal);
      if (host.failStatus !== undefined) {
        return Response.json(
          {
            type: 'error',
            error: `boom ${host.failStatus}`,
            error_code: host.failStatus,
          },
          { status: host.failStatus },
        );
      }
      return fake.fetch(url, init);
    },
    sleep: async () => undefined,
  });
  const runtime = new IncusRuntime(cfg, {
    client,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  });
  const hostBackend: HostBackend = {
    kind: 'incus',
    async init() {
      if (host.initError !== undefined) throw new Error(host.initError);
    },
    async shutdown() {},
    async health(): Promise<HealthResult> {
      return host.down
        ? { ok: false, error: 'unreachable' }
        : { ok: true, detail: 'incus 7' };
    },
    async warmImage() {
      if (host.imageError !== undefined) throw new Error(host.imageError);
    },
    async sweepOrphans() {
      return 0;
    },
  };
  const parts: EndpointParts = {
    name,
    cfg,
    drained: options.drained ?? false,
    host: hostBackend,
    session: new IncusSessionBackend(cfg, {
      runtime,
      runnerdHealth: runnerd.health,
      runnerdEnvPatch: runnerd.envPatch,
    }),
    room: async () => readProjectRoom(client, 'tank', name),
    inFlight: () => runtime.inFlight,
    retireStandbys: async () => {
      host.retired += 1;
    },
  };
  return Object.assign(host, { name, fake, parts });
}

async function fleet(
  hosts: Record<string, HostOptions>,
  maxSessions = 100,
  setup: { incus?: Partial<IncusConfig>; record?: PlacementRecord } = {},
) {
  const base = incusTestConfig(setup.incus ?? {}, {});
  const cfg: SpawnerConfig = {
    ...base,
    session: { ...base.session, maxSessions },
  };
  const made = Object.entries(hosts).map(([name, options]) =>
    makeHost(cfg, name, options),
  );
  const store = new MemoryPlacementStore(setup.record);
  const set = new IncusEndpointSet(
    made.map((host) => host.parts),
    { record: store, now: () => clock.now },
  );
  const host = new MultiIncusBackend(set);
  await host.init();
  await host.warmImage();
  const backend = new MultiIncusSessionBackend(set);
  const byName = Object.fromEntries(made.map((h) => [h.name, h]));
  /** The host whose fake holds the session's workspace volume. */
  const holderOf = (sessionId: string) =>
    made
      .filter((h) => h.fake.volumes.has(incusWorkspaceVolumeName(sessionId)))
      .map((h) => h.name);
  /** The spawner restarted over the same hosts (or those named), with the
   * record it left behind (or the one given). */
  const restart = async (
    names: readonly string[] = made.map((h) => h.name),
    record: MemoryPlacementStore = store,
  ) => {
    const again = new IncusEndpointSet(
      names.map((name) => byName[name]!.parts),
      { record, now: () => clock.now },
    );
    const lifecycle = new MultiIncusBackend(again);
    await lifecycle.init();
    await lifecycle.warmImage();
    return {
      set: again,
      host: lifecycle,
      backend: new MultiIncusSessionBackend(again),
    };
  };
  return { set, host, backend, hosts: byName, holderOf, store, restart };
}

beforeEach(() => {
  clock.now = START_MS;
});

describe('a new session', () => {
  test('goes to the host with the most sessions left under its cap', async () => {
    const f = await fleet({
      'node-1': { maxSessions: 4 },
      'node-2': { maxSessions: 4 },
    });
    await f.backend.createSession(specOf('one'));
    await f.backend.createSession(specOf('two'));
    await f.backend.createSession(specOf('three'));
    expect(f.holderOf('one')).toEqual(['node-1']);
    expect(f.holderOf('two')).toEqual(['node-2']);
    expect(f.holderOf('three')).toEqual(['node-1']);
    expect(f.set.placementOf('three')).toBe('node-1');
  });

  test('goes where the project has the most memory left', async () => {
    const f = await fleet({
      'node-1': { memory: '12GiB' },
      'node-2': { memory: '64GiB' },
    });
    await f.backend.createSession(specOf('one'));
    await f.backend.createSession(specOf('two'));
    expect(f.holderOf('one')).toEqual(['node-2']);
    expect(f.holderOf('two')).toEqual(['node-2']);
  });

  test('is refused, as a full spawner, when every host is at its cap', async () => {
    const f = await fleet({
      'node-1': { maxSessions: 1 },
      'node-2': { maxSessions: 1 },
    });
    await f.backend.createSession(specOf('one'));
    await f.backend.createSession(specOf('two'));
    const refused = await rejection(f.backend.createSession(specOf('three')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused).toMatchObject({ reason: 'full' });
    expect(refused.message).toContain(
      'node-1: its session cap is reached (1/1)',
    );
    expect(f.holderOf('three')).toEqual([]);
  });

  test('counts the creates placed on a host before its listing shows them', async () => {
    const f = await fleet({
      'node-1': { maxSessions: 1 },
      'node-2': { maxSessions: 1 },
    });
    await Promise.all([
      f.backend.createSession(specOf('one')),
      f.backend.createSession(specOf('two')),
    ]);
    expect([...f.holderOf('one'), ...f.holderOf('two')].sort()).toEqual([
      'node-1',
      'node-2',
    ]);
  });

  test('a host that failed its boot checks takes none until it passes', async () => {
    const f = await fleet({
      'node-1': { initError: 'profile sandbox has no NIC on sbx0' },
      'node-2': {},
    });
    expect(
      error.mock.calls.some((call) =>
        String(call[0]).includes('node-1 takes no session'),
      ),
    ).toBe(true);
    await f.backend.createSession(specOf('one'));
    expect(f.holderOf('one')).toEqual(['node-2']);
  });

  test('a host without its runtime image takes none until the image is back', async () => {
    const f = await fleet({
      'node-1': { imageError: 'pull refused' },
      'node-2': { maxSessions: 1 },
    });
    await f.backend.createSession(specOf('one'));
    expect(f.holderOf('one')).toEqual(['node-2']);
    expect(
      warnings().some((line) =>
        line.includes(
          'node-1 is passed over for new sessions: its runtime image is not ready',
        ),
      ),
    ).toBe(true);
    f.hosts['node-1']!.imageError = undefined;
    await f.host.warmImage();
    await f.backend.createSession(specOf('two'));
    expect(f.holderOf('two')).toEqual(['node-1']);
  });

  test('boot fails only when no host passes its checks', async () => {
    const base = incusTestConfig();
    const set = new IncusEndpointSet(
      [
        makeHost(base, 'node-1', { initError: 'untrusted' }).parts,
        makeHost(base, 'node-2', { initError: 'no project' }).parts,
      ],
      { record: new MemoryPlacementStore() },
    );
    const err = await rejection(new MultiIncusBackend(set).init());
    expect(err.message).toContain('- node-1: untrusted');
    expect(err.message).toContain('- node-2: no project');
  });
});

describe('a drained host', () => {
  test('takes no new session, while its sessions carry on and resume there', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('kept'));
    expect(f.holderOf('kept')).toEqual(['node-1']);

    // The operator drains node-1: the spawner restarts with `"drained": true`.
    const set = new IncusEndpointSet(
      [
        { ...f.hosts['node-1']!.parts, drained: true },
        f.hosts['node-2']!.parts,
      ],
      { record: f.store, now: () => clock.now },
    );
    const restarted = new MultiIncusBackend(set);
    await restarted.init();
    await restarted.warmImage();
    const backend = new MultiIncusSessionBackend(set);

    // Its running session is listed and served.
    expect((await backend.listSessions()).map((s) => s.sessionId)).toEqual([
      'kept',
    ]);
    expect(await backend.sessionExists('kept')).toBe(true);
    // A new one goes elsewhere, though node-1 has as much room.
    await backend.createSession(specOf('new'));
    expect(f.holderOf('new')).toEqual(['node-2']);
    // A stopped session resumes where its workspace is.
    expect(await backend.stopSession('kept')).toBe(true);
    const resumed = await backend.createSession(specOf('kept'));
    expect(resumed.resumed).toBe(true);
    expect(set.placementOf('kept')).toBe('node-1');
  });

  test('keeps no warm standby', async () => {
    const f = await fleet({ 'node-1': { drained: true }, 'node-2': {} });
    expect(f.hosts['node-1']!.retired).toBe(1);
    expect(f.hosts['node-2']!.retired).toBe(0);
  });

  test('when every host is drained, a new session is refused', async () => {
    const f = await fleet({
      'node-1': { drained: true },
      'node-2': { drained: true },
    });
    const refused = await rejection(f.backend.createSession(specOf('one')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused.message).toContain('node-1: drained; node-2: drained');
  });
});

describe('a host that does not answer', () => {
  test('is skipped for new sessions, with its reason logged', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    f.hosts['node-1']!.down = true;
    await f.backend.createSession(specOf('one'));
    expect(f.holderOf('one')).toEqual(['node-2']);
    expect(
      warnings().some(
        (line) =>
          line.includes('node-1 did not answer') &&
          line.includes('ECONNREFUSED node-1'),
      ),
    ).toBe(true);
    // Not asked again until its back-off has passed.
    const asked = f.hosts['node-1']!.fake.requests.length;
    await f.backend.createSession(specOf('two'));
    expect(f.hosts['node-1']!.fake.requests.length).toBe(asked);
    expect(f.holderOf('two')).toEqual(['node-2']);
  });

  test('keeps its sessions listed as last seen, and its calls fail rather than read as gone', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('there'));
    expect(f.holderOf('there')).toEqual(['node-1']);
    expect((await f.backend.listSessions()).length).toBe(1);

    f.hosts['node-1']!.down = true;
    expect((await f.backend.listSessions()).map((s) => s.sessionId)).toEqual([
      'there',
    ]);
    const err = await rejection(f.backend.sessionExists('there'));
    expect(err.message).toContain('node-1');
    // The workspace of a host that does not answer is never reported done.
    expect(await f.backend.workspaceDeletion('there')).toBe('pending');
  });

  test('is asked again after its back-off, and serves once it answers', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    f.hosts['node-1']!.down = true;
    await f.backend.createSession(specOf('one'));
    f.hosts['node-1']!.down = false;
    clock.now += UNREACHABLE_RETRY_MS;
    await f.backend.createSession(specOf('two'));
    expect(f.holderOf('two')).toEqual(['node-1']);
    expect(
      log.mock.calls.some((call) =>
        String(call[0]).includes('node-1 answers again'),
      ),
    ).toBe(true);
  });

  test('when no host answers, a create is unavailable and the listing throws', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    f.hosts['node-1']!.down = true;
    f.hosts['node-2']!.down = true;
    const refused = await rejection(f.backend.createSession(specOf('one')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused).toMatchObject({ reason: 'unavailable' });
    expect(await rejection(f.backend.listSessions())).toBeInstanceOf(Error);
    expect((await f.host.health()).ok).toBe(false);
  });

  test('a session whose host does not answer is not started elsewhere', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('home'));
    await f.backend.stopSession('home');
    f.hosts['node-1']!.down = true;
    const refused = await rejection(f.backend.createSession(specOf('home')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused).toMatchObject({ reason: 'unavailable' });
    expect(f.holderOf('home')).toEqual(['node-1']);
  });
});

describe('a session stays on its host', () => {
  test('a resume goes back to the host of its workspace, though another has more room', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('a'));
    await f.backend.createSession(specOf('b'));
    await f.backend.createSession(specOf('c'));
    expect(f.holderOf('c')).toEqual(['node-1']);
    await f.backend.stopSession('c');
    // node-1 now holds a, node-2 holds b: a tie, but c's workspace is on
    // node-1 — and it stays there even with node-2 emptied.
    await f.backend.destroySession('b');
    const resumed = await f.backend.createSession(specOf('c'));
    expect(resumed.resumed).toBe(true);
    expect(f.holderOf('c')).toEqual(['node-1']);
  });

  test('a restarted spawner finds each session on its host from the record', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('a'));
    await f.backend.createSession(specOf('b'));
    const { set, backend } = await f.restart();
    expect(set.placementOf('a')).toBe('node-1');
    expect(set.placementOf('b')).toBe('node-2');
    expect(
      (await backend.listSessions()).map((s) => s.sessionId).sort(),
    ).toEqual(['a', 'b']);
    expect(set.placementOf('a')).toBe('node-1');
    expect(set.placementOf('b')).toBe('node-2');
    expect(await backend.resolveEndpoint('b')).toMatch(/^http:\/\//);
  });

  test('a destroy deletes the workspace on its host, and a session no host holds is simply absent', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('a'));
    await f.backend.createSession(specOf('b'));
    expect(await f.backend.destroySession('b')).toBe(true);
    expect(f.holderOf('b')).toEqual([]);
    expect(await f.backend.workspaceDeletion('b')).toBe('done');
    expect(await f.backend.sessionExists('nowhere')).toBe(false);
    expect(await f.backend.hasWorkspace('nowhere')).toBe(false);
    expect(await f.backend.destroySession('nowhere')).toBe(false);
    expect((await f.backend.listWorkspaces()).map((w) => w.sessionId)).toEqual([
      'a',
    ]);
  });
});

describe('the host lifecycle', () => {
  test('health names each host and holds while one is up', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': { drained: true } });
    f.hosts['node-1']!.down = true;
    const health = await f.host.health();
    expect(health).toEqual({
      ok: true,
      detail: 'node-1: down: unreachable; node-2 (drained): incus 7',
    });
  });

  test('the egress address is common to the hosts, or none', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    expect(await f.backend.egressAddress()).toBe('10.9.0.2');
  });
});

describe('the placement record', () => {
  test('a restarted spawner resumes a session only on its recorded host, never elsewhere', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('home'));
    expect(f.holderOf('home')).toEqual(['node-1']);
    await f.backend.stopSession('home');

    // The spawner restarts while node-1 is down: nothing in memory says where
    // the session lives, but the record does.
    f.hosts['node-1']!.down = true;
    const { backend, set } = await f.restart();
    const refused = await rejection(backend.createSession(specOf('home')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused).toMatchObject({ reason: 'unavailable' });
    expect(refused.message).toContain('lives on node-1, which does not answer');
    expect(f.holderOf('home')).toEqual(['node-1']);
    // The other calls for it fail too, rather than read it as gone.
    expect((await rejection(backend.hasWorkspace('home'))).message).toContain(
      'node-1',
    );
    // A session the record does not name is new, and is placed freely.
    await backend.createSession(specOf('fresh'));
    expect(f.holderOf('fresh')).toEqual(['node-2']);
    expect(set.placementOf('fresh')).toBe('node-2');

    // Once node-1 answers again, the session resumes there.
    f.hosts['node-1']!.down = false;
    clock.now += UNREACHABLE_RETRY_MS;
    const resumed = await backend.createSession(specOf('home'));
    expect(resumed.resumed).toBe(true);
    expect(f.holderOf('home')).toEqual(['node-1']);
  });

  test('a session whose host is no longer declared is refused, not started elsewhere', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('home'));
    await f.backend.stopSession('home');
    const { backend } = await f.restart(['node-2']);
    expect(
      warnings().some((line) =>
        line.includes('names sessions on node-1, which is no longer declared'),
      ),
    ).toBe(true);
    const refused = await rejection(backend.createSession(specOf('home')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused).toMatchObject({ reason: 'unavailable' });
    expect(refused.message).toContain(
      'lives on node-1, which is no longer declared',
    );
    expect(f.holderOf('home')).toEqual(['node-1']);
  });

  test('is written before the create, and a create it cannot be written for is refused', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('one'));
    expect(f.store.saved?.sessions).toEqual({ one: 'node-1' });

    f.store.failure = new Error('no space left on device');
    const refused = await rejection(f.backend.createSession(specOf('two')));
    expect(refused).toBeInstanceOf(SessionPlacementError);
    expect(refused).toMatchObject({ reason: 'unavailable' });
    expect(refused.message).toContain('no space left on device');
    expect(f.holderOf('two')).toEqual([]);
    expect(f.set.placementOf('two')).toBeUndefined();
  });

  test('a spawner whose record cannot be written does not boot', async () => {
    const base = incusTestConfig();
    const store = new MemoryPlacementStore();
    store.failure = new Error('read-only file system');
    const set = new IncusEndpointSet(
      [makeHost(base, 'node-1', {}).parts, makeHost(base, 'node-2', {}).parts],
      { record: store },
    );
    const err = await rejection(new MultiIncusBackend(set).init());
    expect(err.message).toContain('read-only file system');
  });

  test('a listing never moves a recorded session to another host', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('twice'));
    expect(f.holderOf('twice')).toEqual(['node-1']);
    // A record that names node-2 (where an older workspace was made).
    const { set, backend } = await f.restart(
      undefined,
      new MemoryPlacementStore({
        complete: true,
        listed: [],
        sessions: { twice: 'node-2' },
      }),
    );
    await backend.listSessions();
    await backend.listWorkspaces();
    expect(set.placementOf('twice')).toBe('node-2');
    expect(
      warnings().some((line) =>
        line.includes(
          'session twice is recorded on node-2 and is also seen on node-1; it stays on node-2',
        ),
      ),
    ).toBe(true);
  });

  test('a destroy clears the session from the record', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('gone'));
    expect(f.set.placementOf('gone')).toBe('node-1');
    expect(await f.backend.destroySession('gone')).toBe(true);
    expect(f.set.placementOf('gone')).toBeUndefined();
    expect(f.store.saved?.sessions).toEqual({});
    // Made again, it is a new session, placed freely.
    await f.backend.createSession(specOf('gone'));
    expect(f.set.placementOf('gone')).toBe('node-1');
  });

  test('a finished workspace deletion clears the session from the record', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('a'));
    await f.backend.createSession(specOf('b'));
    await f.hosts['node-2']!.parts.session.destroySession('b');
    expect(f.set.placementOf('b')).toBe('node-2');
    expect(await f.backend.workspaceDeletion('b')).toBe('done');
    expect(f.set.placementOf('b')).toBeUndefined();
    expect(f.store.saved?.sessions).toEqual({ a: 'node-1' });
  });
});

describe('the first start with the placement record', () => {
  test('rebuilds the record from every host listing, running sessions and stopped workspaces alike', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('a'));
    await f.backend.createSession(specOf('b'));
    await f.backend.stopSession('b');
    // A spawner from before the record: none on its volume.
    const fresh = new MemoryPlacementStore();
    const { set } = await f.restart(undefined, fresh);
    expect(set.recordComplete).toBe(true);
    expect(fresh.saved).toEqual({
      complete: true,
      listed: [],
      sessions: { a: 'node-1', b: 'node-2' },
    });
  });

  test('refuses a session it has no record of until every host has been listed once', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    await f.backend.createSession(specOf('a'));
    await f.backend.createSession(specOf('b'));
    await f.backend.stopSession('b');

    f.hosts['node-2']!.down = true;
    const fresh = new MemoryPlacementStore();
    const { set, backend } = await f.restart(undefined, fresh);
    expect(set.recordComplete).toBe(false);
    // The progress is kept, for a restart in the middle of it.
    expect(fresh.saved).toEqual({
      complete: false,
      listed: ['node-1'],
      sessions: { a: 'node-1' },
    });
    // A session the listed host holds is served.
    expect(await backend.sessionExists('a')).toBe(true);
    // Any other may live on node-2: b does, and a new id cannot be told from it.
    for (const id of ['b', 'new']) {
      const refused = await rejection(backend.createSession(specOf(id)));
      expect(refused).toBeInstanceOf(SessionPlacementError);
      expect(refused).toMatchObject({ reason: 'unavailable' });
      expect(refused.message).toContain(
        'may live on node-2, which has not been listed since the placement record was started',
      );
    }
    expect(f.holderOf('b')).toEqual(['node-2']);
    expect(f.holderOf('new')).toEqual([]);

    // A restart in the middle goes on where it stopped.
    const again = await f.restart(undefined, fresh);
    expect(again.set.recordComplete).toBe(false);

    // node-2 answers: it is listed, the record completes, and both resume.
    f.hosts['node-2']!.down = false;
    clock.now += UNREACHABLE_RETRY_MS;
    const resumed = await again.backend.createSession(specOf('b'));
    expect(resumed.resumed).toBe(true);
    expect(f.holderOf('b')).toEqual(['node-2']);
    expect(again.set.recordComplete).toBe(true);
    await again.backend.createSession(specOf('new'));
    expect(fresh.saved?.complete).toBe(true);
    expect(fresh.saved?.sessions.b).toBe('node-2');
    expect(fresh.saved?.sessions.new).toBeDefined();
  });
});

describe('the reachability of a host', () => {
  test('each Incus request has its own timeout: a slow host that answers each in time is not taken for unreachable', async () => {
    // A session the record names on node-1 that no longer exists there:
    // asking whether node-1 holds it takes several requests in a row.
    const f = await fleet({ 'node-1': {}, 'node-2': {} }, 100, {
      incus: { apiTimeoutMs: 100 },
      record: { complete: true, listed: [], sessions: { ghost: 'node-1' } },
    });
    f.hosts['node-1']!.latencyMs = 60;
    const before = f.hosts['node-1']!.fake.requests.length;
    expect(await f.backend.hasWorkspace('ghost')).toBe(false);
    expect(
      f.hosts['node-1']!.fake.requests.length - before,
    ).toBeGreaterThanOrEqual(2);
    expect(warnings().some((line) => line.includes('did not answer'))).toBe(
      false,
    );
    await f.backend.createSession(specOf('one'));
    expect(f.holderOf('one')).toEqual(['node-1']);
  });

  test('a request with no answer within its timeout marks the host unreachable', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} }, 100, {
      incus: { apiTimeoutMs: 100 },
    });
    f.hosts['node-1']!.latencyMs = 1_000;
    await f.backend.createSession(specOf('one'));
    expect(f.holderOf('one')).toEqual(['node-2']);
    expect(
      warnings().some(
        (line) =>
          line.includes('node-1 did not answer') && line.includes('skipped'),
      ),
    ).toBe(true);
  });

  test('a host that answers with an Incus error is not marked unreachable', async () => {
    const f = await fleet({ 'node-1': {}, 'node-2': {} });
    f.hosts['node-1']!.failStatus = 500;
    await f.backend.listSessions();
    expect(
      warnings().some((line) =>
        line.includes('node-1 answered the session listing with a failure'),
      ),
    ).toBe(true);
    expect(warnings().some((line) => line.includes('did not answer'))).toBe(
      false,
    );
    // Asked again at once: no back-off.
    const asked = f.hosts['node-1']!.fake.requests.length;
    f.hosts['node-1']!.failStatus = undefined;
    await f.backend.listSessions();
    expect(f.hosts['node-1']!.fake.requests.length).toBeGreaterThan(asked);
  });

  test('tells a failed connection from an answer', () => {
    expect(isConnectionFailure(new TypeError('Unable to connect'))).toBe(true);
    const refused = Object.assign(new Error('refused'), {
      code: 'ECONNREFUSED',
    });
    expect(isConnectionFailure(refused)).toBe(true);
    expect(
      isConnectionFailure(
        Object.assign(new Error('bad cert'), {
          code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        }),
      ),
    ).toBe(true);
    const timeout = new DOMException('timed out', 'TimeoutError');
    expect(isConnectionFailure(timeout)).toBe(true);
    expect(isConnectionFailure(new Error('wrapped', { cause: refused }))).toBe(
      true,
    );
    expect(isConnectionFailure(new IncusApiError('not found', 404))).toBe(
      false,
    );
    expect(isConnectionFailure(new Error('instance still present'))).toBe(
      false,
    );
    expect(isConnectionFailure('a string')).toBe(false);
  });
});
