import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEVICE_HEADER, DeviceHub, type HubOptions } from './hub.ts';
import { PlacementStore } from './placements.ts';
import {
  FRAME,
  TUNNEL_CLOSE,
  TUNNEL_PROTOCOL_VERSION,
  TunnelClosedError,
  TunnelEndpoint,
  type IncomingStream,
  type TunnelTransport,
} from './tunnel.ts';

const TOKEN = 'hub-test-token';
const ORG = 'org_a';
const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

async function makeHub(overrides: Partial<HubOptions> = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'tale-hub-'));
  dirs.push(stateDir);
  const upstreamCalls: Array<{ url: string; init: RequestInit }> = [];
  const hub = new DeviceHub({
    token: TOKEN,
    version: '0.5.60',
    stateDir,
    relays: {
      api: 'http://backend-api:3005',
      gateway: 'http://sandbox-llm-gateway:8080',
    },
    isLocalSession: () => Promise.resolve(false),
    fetch: (url, init) => {
      upstreamCalls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ upstream: url }), {
          status: 200,
          headers: { 'content-type': 'application/json', connection: 'close' },
        }),
      );
    },
    ...overrides,
  });
  await hub.start();
  return { hub, stateDir, upstreamCalls };
}

interface FakeDevice {
  endpoint: TunnelEndpoint;
  closes: Array<{ code: number; reason: string }>;
  served: Array<{ method: string; path: string; body: string }>;
  hello(extra?: Record<string, unknown>): Promise<void>;
  status(extra: Record<string, unknown>): Promise<void>;
}

/** A device joined to the hub over an in-memory pipe. `respond` decides what
 * the device answers each forwarded call. */
function connectDevice(
  hub: DeviceHub,
  deviceId: string,
  respond: (s: IncomingStream, body: string) => void = (s) =>
    s.respond(
      { status: 201, headers: [['content-type', 'application/json']] },
      new Response(JSON.stringify({ ok: deviceId })).body,
    ),
  organizationId = ORG,
): FakeDevice {
  const closes: Array<{ code: number; reason: string }> = [];
  const served: FakeDevice['served'] = [];
  const toDevice: Uint8Array[] = [];
  const deliver = (queue: Uint8Array[], to: () => void) => {
    setTimeout(to, 0);
    return queue;
  };
  const hubTransport: TunnelTransport = {
    send: (frame) => {
      toDevice.push(frame);
      deliver(toDevice, () => {
        for (const f of toDevice.splice(0)) device.receive(f);
      });
    },
    bufferedAmount: () => 0,
    close: (code, reason) => {
      closes.push({ code, reason });
      setTimeout(() => device.close(new TunnelClosedError(reason)), 0);
    },
  };
  const device: TunnelEndpoint = new TunnelEndpoint(
    'device',
    {
      send: (frame) => setTimeout(() => connection.receive(frame), 0),
      bufferedAmount: () => 0,
      close: () => setTimeout(() => connection.closed(), 0),
    },
    {
      onStream: (s) => {
        void new Response(s.body).text().then((body) => {
          served.push({ method: s.head.method, path: s.head.path, body });
          respond(s, body);
          return null;
        });
      },
      onControl: () => {},
    },
  );
  const connection = hub.attach(
    {
      deviceId,
      organizationId,
      issuedAtMs: Date.now(),
      expiresAtMs: Date.now() + 900_000,
    },
    hubTransport,
  );
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return {
    endpoint: device,
    closes,
    served,
    async hello(extra = {}) {
      device.sendControl(FRAME.HELLO, {
        protocol: TUNNEL_PROTOCOL_VERSION,
        version: '0.5.60',
        maxSessions: 2,
        platform: { os: 'linux', arch: 'x64' },
        sessions: [],
        ...extra,
      });
      await settle();
    },
    async status(extra) {
      device.sendControl(FRAME.STATUS, {
        maxSessions: 2,
        running: 0,
        starting: 0,
        sessions: [],
        ...extra,
      });
      await settle();
    },
  };
}

function createRequest(
  sessionId: string,
  placement?: string,
): {
  req: Request;
  url: URL;
  body: string;
} {
  const body = JSON.stringify({
    sessionId,
    organizationId: ORG,
    profile: 'agent',
    ...(placement ? { placement } : {}),
  });
  const url = new URL('http://sandbox/v1/sessions');
  return {
    req: new Request(url.toString(), {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    }),
    url,
    body,
  };
}

function callRequest(method: string, path: string): { req: Request; url: URL } {
  const url = new URL(`http://sandbox${path}`);
  return { req: new Request(url.toString(), { method }), url };
}

describe('DeviceHub placement', () => {
  test('a device-eligible create lands on a connected device and sticks there', async () => {
    const { hub, stateDir } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const { req, url, body } = createRequest('pa-agent1', 'device');
    const res = await hub.maybeForward(req, url, body);
    expect(res?.status).toBe(201);
    expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-1');
    expect(await res?.json()).toEqual({ ok: 'dev-1' });
    expect(d1.served[0]?.path).toBe('/v1/sessions');
    expect(JSON.parse(d1.served[0]?.body ?? '{}').sessionId).toBe('pa-agent1');

    // Later calls for the session go to the same device…
    const exec = callRequest('GET', '/v1/sessions/pa-agent1/files?path=.');
    const execRes = await hub.maybeForward(exec.req, exec.url, '');
    expect(execRes?.headers.get(DEVICE_HEADER)).toBe('dev-1');
    expect(d1.served[1]?.path).toBe('/v1/sessions/pa-agent1/files?path=.');

    // …and the placement is on disk for a restarted hub.
    const reloaded = new PlacementStore(join(stateDir, 'placements.json'));
    await reloaded.load();
    expect(reloaded.get('pa-agent1')).toMatchObject({
      deviceId: 'dev-1',
      organizationId: ORG,
    });
  });

  test('without a device placement hint the server keeps the session', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const { req, url, body } = createRequest('rnd-abc');
    expect(await hub.maybeForward(req, url, body)).toBeNull();
    expect(d1.served).toHaveLength(0);
  });

  test('a session the server already holds is never moved to a device', async () => {
    const { hub } = await makeHub({
      isLocalSession: (id) => Promise.resolve(id === 'pa-old'),
    });
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const { req, url, body } = createRequest('pa-old', 'device');
    expect(await hub.maybeForward(req, url, body)).toBeNull();
  });

  test('only the organization of the device may use it', async () => {
    const { hub } = await makeHub();
    const other = connectDevice(hub, 'dev-x', undefined, 'org_b');
    await other.hello();
    const { req, url, body } = createRequest('pa-agent2', 'device');
    expect(await hub.maybeForward(req, url, body)).toBeNull();
    expect(other.served).toHaveLength(0);
  });

  test('a device on another release takes no new sessions', async () => {
    const { hub } = await makeHub();
    const old = connectDevice(hub, 'dev-old');
    await old.hello({ version: '0.5.59' });
    const { req, url, body } = createRequest('pa-agent3', 'device');
    expect(await hub.maybeForward(req, url, body)).toBeNull();
    expect(hub.devicesFor(ORG)[0]?.compatible).toBe(false);
    expect(hub.deviceSessionCapacity(ORG)).toBe(0);
  });

  test('a full device is skipped: the least-loaded one with room wins', async () => {
    const { hub } = await makeHub();
    const busy = connectDevice(hub, 'dev-busy');
    await busy.hello();
    await busy.status({ running: 2 });
    const free = connectDevice(hub, 'dev-free');
    await free.hello();
    const { req, url, body } = createRequest('wf-run1', 'device');
    const res = await hub.maybeForward(req, url, body);
    expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-free');
    expect(busy.served).toHaveLength(0);
  });

  test('a device answering 429 releases the placement and the server takes over', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1', (s) =>
      s.respond({ status: 429, headers: [['retry-after', '10']] }, null),
    );
    await d1.hello();
    const { req, url, body } = createRequest('pa-agent4', 'device');
    expect(await hub.maybeForward(req, url, body)).toBeNull();
    expect(hub.capacityOverlay(ORG).placements).toEqual([]);
  });

  test('a device that is draining or drops mid-create hands the session on', async () => {
    const { hub } = await makeHub();
    const draining = connectDevice(hub, 'dev-draining', (s) =>
      s.respond(
        { status: 503, headers: [['content-type', 'application/json']] },
        new Response(JSON.stringify({ error: 'draining' })).body,
      ),
    );
    await draining.hello();
    await draining.status({ running: 0 });
    const cut = connectDevice(hub, 'dev-cut', (s) =>
      s.reset('internal', 'connection lost'),
    );
    await cut.hello();
    await cut.status({ running: 1 });
    const fine = connectDevice(hub, 'dev-fine');
    await fine.hello();
    await fine.status({ running: 1 });
    // Most room first (the draining device), then the two with one free
    // slot in the order they connected.
    const { req, url, body } = createRequest('pa-agent9', 'device');
    const res = await hub.maybeForward(req, url, body);
    expect(draining.served).toHaveLength(1);
    expect(cut.served).toHaveLength(1);
    expect(res?.status).toBe(201);
    expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-fine');
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-agent9', deviceId: 'dev-fine' },
    ]);
  });

  test('when every device fails a create, the server takes it', async () => {
    const { hub } = await makeHub();
    const cut = connectDevice(hub, 'dev-cut', (s) =>
      s.reset('internal', 'connection lost'),
    );
    await cut.hello();
    const { req, url, body } = createRequest('pa-agent10', 'device');
    expect(await hub.maybeForward(req, url, body)).toBeNull();
    expect(cut.served).toHaveLength(1);
    expect(hub.capacityOverlay(ORG).placements).toEqual([]);
  });

  test('a device that cannot start sessions hands them on and sits out the next ones', async () => {
    const { hub } = await makeHub();
    const broken = connectDevice(hub, 'dev-broken', (s) =>
      s.respond(
        { status: 502, headers: [['content-type', 'application/json']] },
        new Response(JSON.stringify({ error: 'create_failed' })).body,
      ),
    );
    await broken.hello();
    const healthy = connectDevice(hub, 'dev-healthy');
    await healthy.hello();
    await healthy.status({ running: 1 });
    // The broken one has the most room, so it is asked first — once.
    for (const id of ['pa-b1', 'pa-b2', 'pa-b3']) {
      const { req, url, body } = createRequest(id, 'device');
      const res = await hub.maybeForward(req, url, body);
      expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-healthy');
    }
    expect(broken.served).toHaveLength(1);
    expect(hub.capacityOverlay(ORG).placements.map((p) => p.deviceId)).toEqual([
      'dev-healthy',
      'dev-healthy',
      'dev-healthy',
    ]);
  });

  test('a create the platform gave up on keeps its placement and makes no second copy', async () => {
    const { hub } = await makeHub();
    let answer: () => void = () => {};
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      answer = () =>
        s.respond(
          { status: 201, headers: [['content-type', 'application/json']] },
          new Response('{}').body,
        );
    });
    await d1.hello();
    const aborter = new AbortController();
    const body = JSON.stringify({
      sessionId: 'pa-slow',
      organizationId: ORG,
      profile: 'agent',
      placement: 'device',
    });
    const url = new URL('http://sandbox/v1/sessions');
    const pending = hub.maybeForward(
      new Request(url.toString(), {
        method: 'POST',
        body,
        signal: aborter.signal,
      }),
      url,
      body,
    );
    await new Promise((r) => setTimeout(r, 20));
    aborter.abort();
    const res = await pending;
    answer();
    // Not null: the server must not create a second copy for a caller that
    // is gone. The device may still finish its own.
    expect(res?.status).toBe(499);
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-slow', deviceId: 'dev-1' },
    ]);
  });

  test('a create forwarded while a destroy runs keeps the session placed', async () => {
    const { hub } = await makeHub();
    let finishDestroy: () => void = () => {};
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      if (s.head.method === 'DELETE') {
        finishDestroy = () =>
          s.respond(
            { status: 200, headers: [['content-type', 'application/json']] },
            new Response(JSON.stringify({ destroyed: true, busy: false })).body,
          );
        return;
      }
      s.respond(
        { status: 201, headers: [['content-type', 'application/json']] },
        new Response('{}').body,
      );
    });
    await d1.hello();
    const first = createRequest('pa-turns', 'device');
    await hub.maybeForward(first.req, first.url, first.body);
    const destroy = callRequest('DELETE', '/v1/sessions/pa-turns?if_idle=1');
    const destroying = hub.maybeForward(destroy.req, destroy.url, '');
    await new Promise((r) => setTimeout(r, 20));
    // The next turn's create lands while the device is still destroying.
    const next = createRequest('pa-turns', 'device');
    expect(
      (await hub.maybeForward(next.req, next.url, next.body))?.status,
    ).toBe(201);
    finishDestroy();
    await (await destroying)?.text();
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-turns', deviceId: 'dev-1' },
    ]);
  });

  test('a destroyed session keeps its route to the device until the device confirms the bytes are gone', async () => {
    const { hub } = await makeHub();
    // What the device answers each destroy: an older device's answer with no
    // `deletion` at all (19776cf18 renamed into its trash and deleted in the
    // background), then still deleting, then failing, then done.
    const answers: Array<Record<string, unknown>> = [
      { destroyed: true, busy: false },
      { destroyed: false, busy: false, deletion: 'pending' },
      { destroyed: false, busy: false, deletion: 'failed' },
      { destroyed: false, busy: false, deletion: 'done' },
    ];
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      if (s.head.method === 'DELETE') {
        s.respond(
          { status: 200, headers: [['content-type', 'application/json']] },
          new Response(JSON.stringify(answers.shift())).body,
        );
        return;
      }
      s.respond(
        { status: 201, headers: [['content-type', 'application/json']] },
        new Response('{}').body,
      );
    });
    await d1.hello();
    const create = createRequest('pa-erased', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    const destroy = async () => {
      const call = callRequest(
        'DELETE',
        '/v1/sessions/pa-erased?await_deletion=1',
      );
      // `null`: the hub's own backend would answer — and it holds nothing.
      const res = await hub.maybeForward(call.req, call.url, '');
      return res === null ? null : res.json();
    };
    for (const expected of [{ destroyed: true }, { deletion: 'pending' }]) {
      expect(await destroy()).toMatchObject(expected);
      // No session lives there any more: the capacity view drops it.
      expect(hub.capacityOverlay(ORG).placements).toEqual([]);
    }
    expect(await destroy()).toMatchObject({ deletion: 'failed' });
    expect(await destroy()).toMatchObject({ deletion: 'done' });
    // Confirmed: the route goes, and so does the next destroy's trip.
    expect(await destroy()).toBeNull();
    expect(d1.served.filter((call) => call.method === 'DELETE')).toHaveLength(
      4,
    );
  });

  test('a fresh session under an id whose bytes a device still deletes goes back there while it can, else is placed anew', async () => {
    const { hub } = await makeHub();
    const respond = (s: IncomingStream) => {
      if (s.head.method === 'DELETE') {
        // An older device: no deletion state in its answer.
        s.respond(
          { status: 200, headers: [['content-type', 'application/json']] },
          new Response(JSON.stringify({ destroyed: true, busy: false })).body,
        );
        return;
      }
      s.respond(
        { status: 201, headers: [['content-type', 'application/json']] },
        new Response('{}').body,
      );
    };
    const d1 = connectDevice(hub, 'dev-1', respond);
    await d1.hello();
    const create = () => {
      const call = createRequest('pa-again', 'device');
      return hub.maybeForward(call.req, call.url, call.body);
    };
    const destroy = async () => {
      const call = callRequest('DELETE', '/v1/sessions/pa-again');
      await (await hub.maybeForward(call.req, call.url, ''))?.text();
    };
    expect((await create())?.headers.get(DEVICE_HEADER)).toBe('dev-1');
    await destroy();
    // A roomier device joins; least-loaded would pick it. The fresh session
    // goes back to the device holding the old bytes while that one can
    // take it, so one place keeps answering for both.
    const d2 = connectDevice(hub, 'dev-2', respond);
    await d2.hello({ maxSessions: 8 });
    expect((await create())?.headers.get(DEVICE_HEADER)).toBe('dev-1');
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-again', deviceId: 'dev-1' },
    ]);
    await destroy();
    // dev-1 drops off: a new session never waits on an old workspace's
    // bytes — it is placed anew, and that route is let go.
    const conn = hub.attach(
      {
        deviceId: 'dev-1',
        organizationId: ORG,
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + 900_000,
      },
      { send: () => {}, bufferedAmount: () => 0, close: () => {} },
    );
    conn.closed();
    expect((await create())?.headers.get(DEVICE_HEADER)).toBe('dev-2');
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-again', deviceId: 'dev-2' },
    ]);
  });

  test('removing a device forgets where its sessions were', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const create = createRequest('pa-agent5', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    expect(await hub.disconnect('dev-1')).toEqual({
      disconnected: true,
      placementsDropped: 1,
    });
    expect(d1.closes).toContainEqual({
      code: TUNNEL_CLOSE.REVOKED,
      reason: 'device removed',
    });
    // The removed device's workspaces are out of reach: the session id is
    // the server's to serve (a 404 there tells the platform it is gone).
    const call = callRequest('GET', '/v1/sessions/pa-agent5');
    expect(await hub.maybeForward(call.req, call.url, '')).toBeNull();
  });

  test('a device that drops keeps its sessions placed and answers device_offline', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const create = createRequest('pa-agent6', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    // The socket drops (no revocation): the placement must survive.
    const conn = hub.attach(
      {
        deviceId: 'dev-1',
        organizationId: ORG,
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + 900_000,
      },
      { send: () => {}, bufferedAmount: () => 0, close: () => {} },
    );
    conn.closed();
    const call = callRequest('POST', '/v1/sessions/pa-agent6/exec');
    const res = await hub.maybeForward(call.req, call.url, '{}');
    expect(res?.status).toBe(503);
    expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-1');
    expect(await res?.json()).toMatchObject({
      error: 'device_offline',
      deviceId: 'dev-1',
    });
    expect(d1.closes).toContainEqual({
      code: TUNNEL_CLOSE.REPLACED,
      reason: 'another connection authenticated as this device',
    });
  });

  test('destroy forgets the placement unless the session was busy', async () => {
    const { hub } = await makeHub();
    let destroyBody = JSON.stringify({ destroyed: false, busy: true });
    const d1 = connectDevice(hub, 'dev-1', (s) =>
      s.respond(
        { status: 200, headers: [['content-type', 'application/json']] },
        new Response(
          s.head.method === 'DELETE' ? destroyBody : JSON.stringify({}),
        ).body,
      ),
    );
    await d1.hello();
    const create = createRequest('pa-agent7', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    const idle = callRequest('DELETE', '/v1/sessions/pa-agent7?if_idle=1');
    const busyRes = await hub.maybeForward(idle.req, idle.url, '');
    expect(await busyRes?.json()).toEqual({ destroyed: false, busy: true });
    expect(hub.capacityOverlay(ORG).placements).toHaveLength(1);
    destroyBody = JSON.stringify({ destroyed: true });
    const del = callRequest('DELETE', '/v1/sessions/pa-agent7');
    await hub.maybeForward(del.req, del.url, '');
    expect(hub.capacityOverlay(ORG).placements).toHaveLength(0);
  });

  test("a device's report never claims a session id", async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    // Reporting another organization's session id plants nothing: its calls
    // stay with the server, and the device never receives them.
    await d1.hello({
      sessions: [{ sessionId: 'pa-victim', state: 'running' }],
    });
    await d1.status({
      sessions: [{ sessionId: 'pa-victim', state: 'running' }],
    });
    expect(hub.capacityOverlay(ORG).placements).toEqual([]);
    expect(hub.capacityOverlay(ORG).runtimeSessions).toEqual([]);
    const call = callRequest('POST', '/v1/sessions/pa-victim/exec');
    expect(await hub.maybeForward(call.req, call.url, '{}')).toBeNull();
    expect(d1.served).toHaveLength(0);
  });

  test('a device cannot offer more sandboxes than any device may', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    // The number raises the organization's quota ceiling: bounded.
    await d1.hello({ maxSessions: 100_000 });
    expect(d1.closes).toContainEqual({
      code: TUNNEL_CLOSE.PROTOCOL_ERROR,
      reason: 'malformed HELLO',
    });
    expect(hub.deviceSessionCapacity(ORG)).toBe(0);
  });

  test('a second HELLO on one connection is a protocol error', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    await d1.hello();
    expect(d1.closes).toContainEqual({
      code: TUNNEL_CLOSE.PROTOCOL_ERROR,
      reason: 'HELLO was already received',
    });
  });

  test('a create for a session placed in another organization is refused outright', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const create = createRequest('pa-shared', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    const body = JSON.stringify({
      sessionId: 'pa-shared',
      organizationId: 'org_other',
      profile: 'agent',
      placement: 'device',
    });
    const url = new URL('http://sandbox/v1/sessions');
    const res = await hub.maybeForward(
      new Request(url.toString(), { method: 'POST', body }),
      url,
      body,
    );
    // Not 409: the platform would read that as "it exists, acquire it".
    expect(res?.status).toBe(403);
    expect(d1.served).toHaveLength(1);
  });

  test('capacity: limits, summaries and the runtime overlay', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello({ platform: { os: 'darwin', arch: 'arm64', cpus: 10 } });
    const create = createRequest('pa-x', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    await d1.status({
      maxSessions: 4,
      running: 1,
      // Only what the hub placed there is shown; the rest is the device's.
      sessions: [
        { sessionId: 'pa-x', state: 'running' },
        { sessionId: 'pa-unplaced', state: 'running' },
      ],
    });
    expect(hub.deviceSessionCapacity(ORG)).toBe(4);
    expect(hub.devicesFor(ORG)).toEqual([
      expect.objectContaining({
        deviceId: 'dev-1',
        version: '0.5.60',
        compatible: true,
        maxSessions: 4,
        sessions: { running: 1, starting: 0 },
        platform: expect.objectContaining({ os: 'darwin', cpus: 10 }),
      }),
    ]);
    expect(hub.capacityOverlay(ORG).runtimeSessions).toEqual([
      { sessionId: 'pa-x', state: 'running', deviceId: 'dev-1' },
    ]);
    expect(hub.devicesFor('org_other')).toEqual([]);
  });
});

describe('DeviceHub relays', () => {
  async function relayThrough(
    relay: string,
    path: string,
    method = 'POST',
  ): Promise<{
    status: number;
    body: unknown;
    calls: Array<{ url: string; init: RequestInit }>;
  }> {
    const { hub, upstreamCalls } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const res = await d1.endpoint.request(
      {
        method,
        path,
        headers: [
          ['authorization', 'Bearer sk-bf-session'],
          ['x-tale-sandbox-device', 'forged'],
          ['connection', 'keep-alive'],
        ],
        relay,
      },
      method === 'GET' ? null : '{"model":"m"}',
    );
    return {
      status: res.status,
      body: await new Response(res.body).json(),
      calls: upstreamCalls,
    };
  }

  test('inference calls reach the gateway with the device named, hop headers dropped', async () => {
    const out = await relayThrough('gateway', '/anthropic/v1/messages');
    expect(out.status).toBe(200);
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0]?.url).toBe(
      'http://sandbox-llm-gateway:8080/anthropic/v1/messages',
    );
    const headers = new Headers(out.calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-bf-session');
    expect(headers.get(DEVICE_HEADER)).toBe('dev-1');
    expect(headers.get('connection')).toBeNull();
    // Bytes pass as the upstream sent them (a decompressed body would stay
    // labelled gzip), and no connection is reused after a streamed body.
    expect(out.calls[0]?.init).toMatchObject({
      decompress: false,
      keepalive: false,
    });
  });

  test('the in-sandbox doors reach the backend', async () => {
    const out = await relayThrough('api', '/api/sandbox-blob?token=t', 'GET');
    expect(out.status).toBe(200);
    expect(out.calls[0]?.url).toBe(
      'http://backend-api:3005/api/sandbox-blob?token=t',
    );
    expect(out.calls[0]?.init.body).toBeUndefined();
  });

  test("the gateway's management API is never relayed", async () => {
    const out = await relayThrough('gateway', '/api/governance/virtual-keys');
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: 'relay_path_forbidden' });
    expect(out.calls).toHaveLength(0);
  });

  test('other backend routes are not reachable through the api relay', async () => {
    for (const path of [
      '/api/app/sandbox/limits',
      '/api/control/provision',
      '/api/toolsx',
      '/api/tools/../app',
      // A URL parser drops tabs and newlines AFTER a naive check, turning
      // these into `/../`.
      '/api/tools/.\t./.\t./api/control/migrate',
      '/api/sandbox-blob/.\r./.\n./api/app/organizations',
      '/api/tools/%2e%2e/%2e%2e/api/app',
      '/api/tools/%252e%252e/app',
      '//backend-api:3005/api/app',
    ]) {
      const out = await relayThrough('api', path);
      expect(out.status).toBe(403);
      expect(out.calls).toHaveLength(0);
    }
    const gateway = await relayThrough('gateway', '/openai/.\t./api/providers');
    expect(gateway.status).toBe(403);
    expect(gateway.calls).toHaveLength(0);
  });

  test('only ordinary HTTP methods pass', async () => {
    const out = await relayThrough('api', '/api/tools/search', 'TRACE');
    expect(out.status).toBe(403);
    expect(out.calls).toHaveLength(0);
  });

  test('a device cannot speak for the client address or bring cookies', async () => {
    const { hub, upstreamCalls } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const res = await d1.endpoint.request(
      {
        method: 'POST',
        path: '/api/tools/search',
        headers: [
          ['authorization', 'Bearer tsess_x'],
          ['x-forwarded-for', '10.0.0.1'],
          ['x-real-ip', '10.0.0.1'],
          ['forwarded', 'for=10.0.0.1'],
          ['cookie', 'better-auth.session_token=stolen'],
        ],
        relay: 'api',
      },
      '{}',
    );
    await new Response(res.body).text();
    const headers = new Headers(upstreamCalls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer tsess_x');
    for (const name of [
      'x-forwarded-for',
      'x-real-ip',
      'forwarded',
      'cookie',
    ]) {
      expect(headers.get(name)).toBeNull();
    }
  });

  test('an unknown relay answers 502', async () => {
    const out = await relayThrough('db', '/anything');
    expect(out.status).toBe(502);
    expect(out.body).toEqual({ error: 'relay_unavailable' });
  });
});

describe('DeviceHub tickets', () => {
  test('a renewal naming another device closes the tunnel', async () => {
    const { hub } = await makeHub();
    const d1 = connectDevice(hub, 'dev-1');
    await d1.hello();
    const { mintDeviceTicket } = await import('./ticket.ts');
    d1.endpoint.sendControl(FRAME.RENEW, {
      ticket: mintDeviceTicket(
        {
          deviceId: 'dev-2',
          organizationId: ORG,
          issuedAtMs: Date.now(),
          expiresAtMs: Date.now() + 60_000,
        },
        TOKEN,
      ),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(d1.closes).toContainEqual({
      code: TUNNEL_CLOSE.REVOKED,
      reason: 'ticket renewal refused',
    });
  });

  test("a removed device's unexpired ticket no longer connects", async () => {
    const { hub } = await makeHub();
    const { mintDeviceTicket } = await import('./ticket.ts');
    const issuedAtMs = Date.now() - 1_000;
    const ticket = mintDeviceTicket(
      {
        deviceId: 'dev-1',
        organizationId: ORG,
        issuedAtMs,
        expiresAtMs: issuedAtMs + 900_000,
      },
      TOKEN,
    );
    const req = new Request('http://hub/sandbox/tunnel', {
      headers: { authorization: `Bearer ${ticket}` },
    });
    expect(hub.authenticate(req)?.deviceId).toBe('dev-1');
    await hub.disconnect('dev-1');
    expect(hub.authenticate(req)).toBeNull();
  });

  test('authenticate accepts only a fresh bearer ticket signed with the token', async () => {
    const { hub } = await makeHub();
    const { mintDeviceTicket } = await import('./ticket.ts');
    const good = mintDeviceTicket(
      {
        deviceId: 'dev-1',
        organizationId: ORG,
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      },
      TOKEN,
    );
    const req = (auth?: string) =>
      new Request('http://hub/sandbox/tunnel', {
        headers: auth ? { authorization: auth } : {},
      });
    expect(hub.authenticate(req(`Bearer ${good}`))?.deviceId).toBe('dev-1');
    expect(hub.authenticate(req())).toBeNull();
    expect(hub.authenticate(req(`Bearer ${good}x`))).toBeNull();
    expect(
      hub.authenticate(
        req(
          `Bearer ${mintDeviceTicket(
            {
              deviceId: 'dev-1',
              organizationId: ORG,
              issuedAtMs: Date.now(),
              expiresAtMs: Date.now() + 60_000,
            },
            'another-deployment',
          )}`,
        ),
      ),
    ).toBeNull();
  });
});
