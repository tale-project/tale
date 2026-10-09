import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEVICE_HEADER, DeviceHub, type HubOptions } from './hub.ts';
import { PlacementStore } from './placements.ts';
import {
  FRAME,
  MAX_STREAMS_PER_SIDE,
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

/** Hold one real durable write without changing its publication behavior. */
function holdNextPlacementWrite() {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- causal barrier at the existing private filesystem seam
  const store = PlacementStore.prototype as unknown as {
    writeSnapshot: (placements: ReadonlyMap<string, unknown>) => Promise<void>;
  };
  const write = store.writeSnapshot;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = true;
  store.writeSnapshot = async function (this: unknown, placements) {
    if (hold) {
      hold = false;
      entered.resolve();
      await release.promise;
    }
    return write.call(this, placements);
  };
  return {
    entered: entered.promise,
    release: release.resolve,
    restore() {
      release.resolve();
      store.writeSnapshot = write;
    },
  };
}

describe('DeviceHub placement', () => {
  test.each(['done', 'pending'])(
    'a sweep started during a create write cannot apply its old %s answer to the new route',
    async (answer) => {
      let now = 1_800_000_000_000;
      const { hub, stateDir } = await makeHub({ now: () => now });
      const answered = Promise.withResolvers<void>();
      const device = connectDevice(hub, 'dev-1', (stream) => {
        const sweep = stream.head.path.includes('if_stopped=1');
        stream.respond(
          { status: stream.head.method === 'DELETE' ? 200 : 201, headers: [] },
          new Response(
            JSON.stringify(
              stream.head.method === 'DELETE'
                ? {
                    destroyed: false,
                    busy: false,
                    deletion: sweep ? answer : 'pending',
                  }
                : {},
            ),
          ).body,
        );
        if (sweep) answered.resolve();
      });
      await device.hello();
      const create = () => {
        const call = createRequest('pa-midwrite', 'device');
        return hub.maybeForward(call.req, call.url, call.body);
      };
      await (await create())?.text();
      const destroy = callRequest('DELETE', '/v1/sessions/pa-midwrite');
      await (await hub.maybeForward(destroy.req, destroy.url, ''))?.text();
      const held = holdNextPlacementWrite();
      try {
        const creating = create();
        await held.entered;
        // The new generation already exists, but only the old deleting
        // placement is visible. This ordering is the regression boundary.
        const sweeping = hub.recheckDeleting();
        await answered.promise;
        expect(
          device.served.filter((call) => call.method === 'POST'),
        ).toHaveLength(1);
        held.release();
        expect((await creating)?.status).toBe(201);
        await sweeping;
        expect(hub.capacityOverlay(ORG).placements).toEqual([
          { sessionId: 'pa-midwrite', deviceId: 'dev-1' },
        ]);
        const read = callRequest('GET', '/v1/sessions/pa-midwrite');
        expect(
          (await hub.maybeForward(read.req, read.url, ''))?.headers.get(
            DEVICE_HEADER,
          ),
        ).toBe('dev-1');
        const restarted = new PlacementStore(join(stateDir, 'placements.json'));
        await restarted.load();
        expect(restarted.get('pa-midwrite')).toMatchObject({
          deviceId: 'dev-1',
        });
        expect(restarted.get('pa-midwrite')?.deleting).toBeUndefined();
        now += 5 * 60_000;
        await hub.recheckDeleting();
        expect(
          device.served.filter((call) => call.path.includes('if_stopped=1')),
        ).toHaveLength(1);
      } finally {
        held.restore();
        hub.stop();
      }
    },
  );

  test.each(['removed', 'replaced'])(
    'a candidate %s during an earlier refusal cannot receive a new placement',
    async (change) => {
      const { hub, stateDir } = await makeHub();
      const entered = Promise.withResolvers<IncomingStream>();
      const first = connectDevice(hub, 'dev-first', (stream) =>
        entered.resolve(stream),
      );
      await first.hello({ maxSessions: 3 });
      const stale = connectDevice(hub, 'dev-stale');
      await stale.hello();
      const healthy = connectDevice(hub, 'dev-healthy');
      await healthy.hello({ maxSessions: 1 });
      const call = createRequest('pa-candidate', 'device');
      const creating = hub.maybeForward(call.req, call.url, call.body);
      const pending = await entered.promise;
      let replacement: FakeDevice | undefined;
      try {
        if (change === 'removed') await hub.disconnect('dev-stale');
        else {
          replacement = connectDevice(hub, 'dev-stale');
          await replacement.hello({ version: '0.5.59' });
        }
        pending.respond({ status: 429, headers: [] }, null);
        const response = await creating;
        expect(response?.status).toBe(201);
        expect(response?.headers.get(DEVICE_HEADER)).toBe('dev-healthy');
        expect(stale.served).toEqual([]);
        expect(replacement?.served ?? []).toEqual([]);
        const restarted = new PlacementStore(join(stateDir, 'placements.json'));
        await restarted.load();
        expect(restarted.get('pa-candidate')?.deviceId).toBe('dev-healthy');
      } finally {
        pending.respond({ status: 429, headers: [] }, null);
        hub.stop();
        await creating;
      }
    },
  );

  test.each(['removed', 'replaced'])(
    'a candidate %s during durable publication falls back before sending',
    async (change) => {
      const { hub, stateDir } = await makeHub();
      const stale = connectDevice(hub, 'dev-stale');
      await stale.hello();
      const healthy = connectDevice(hub, 'dev-healthy');
      await healthy.hello({ maxSessions: 1 });
      const held = holdNextPlacementWrite();
      const call = createRequest('pa-before-send', 'device');
      const creating = hub.maybeForward(call.req, call.url, call.body);
      let removing: Promise<unknown> | undefined;
      let replacement: FakeDevice | undefined;
      try {
        await held.entered;
        if (change === 'removed') removing = hub.disconnect('dev-stale');
        else {
          replacement = connectDevice(hub, 'dev-stale');
          await replacement.hello({ version: '0.5.59' });
        }
        held.release();
        const response = await creating;
        await removing;
        expect(response?.status).toBe(201);
        expect(response?.headers.get(DEVICE_HEADER)).toBe('dev-healthy');
        expect(stale.served).toEqual([]);
        expect(replacement?.served ?? []).toEqual([]);
        const restarted = new PlacementStore(join(stateDir, 'placements.json'));
        await restarted.load();
        expect(restarted.get('pa-before-send')?.deviceId).toBe('dev-healthy');
      } finally {
        held.restore();
        await removing;
        await creating;
        hub.stop();
      }
    },
  );

  test('local tunnel saturation releases only the fresh unsent placement', async () => {
    const { hub, stateDir } = await makeHub();
    const waiting: IncomingStream[] = [];
    const saturated = Promise.withResolvers<void>();
    const busy = connectDevice(hub, 'dev-busy', (stream) => {
      if (stream.head.method === 'GET') {
        waiting.push(stream);
        if (waiting.length === MAX_STREAMS_PER_SIDE) saturated.resolve();
      } else stream.respond({ status: 201, headers: [] }, null);
    });
    await busy.hello();
    const create = (id: string) => {
      const call = createRequest(id, 'device');
      return hub.maybeForward(call.req, call.url, call.body);
    };
    await create('pa-established');
    const healthy = connectDevice(hub, 'dev-healthy');
    await healthy.hello({ maxSessions: 1 });
    const reads = Array.from({ length: MAX_STREAMS_PER_SIDE }, () => {
      const call = callRequest('GET', '/v1/sessions/pa-established');
      return hub.maybeForward(call.req, call.url, '');
    });
    try {
      await saturated.promise;
      // A retry may already own a workspace even if this attempt is unsent.
      expect((await create('pa-established'))?.status).toBe(503);
      const response = await create('pa-unsent');
      expect(response?.status).toBe(201);
      expect(response?.headers.get(DEVICE_HEADER)).toBe('dev-healthy');
      expect(busy.served.filter((call) => call.method === 'POST')).toHaveLength(
        1,
      );
      const restarted = new PlacementStore(join(stateDir, 'placements.json'));
      await restarted.load();
      expect(restarted.get('pa-established')?.deviceId).toBe('dev-busy');
      expect(restarted.get('pa-unsent')?.deviceId).toBe('dev-healthy');
    } finally {
      for (const stream of waiting)
        stream.respond({ status: 200, headers: [] }, null);
      await Promise.all(reads);
      hub.stop();
    }
  });

  test.each(['device_busy', 'device_offline'])(
    'a remote503 naming %s remains ambiguous and cannot authorize fallback',
    async (error) => {
      const { hub } = await makeHub();
      const remote = connectDevice(hub, 'dev-remote', (stream) =>
        stream.respond(
          {
            status: 503,
            headers: [
              ['content-type', 'application/json'],
              [DEVICE_HEADER, 'dev-remote'],
            ],
          },
          new Response(JSON.stringify({ error, deviceId: 'dev-remote' })).body,
        ),
      );
      await remote.hello();
      const healthy = connectDevice(hub, 'dev-healthy');
      await healthy.hello({ maxSessions: 1 });
      try {
        const call = createRequest('pa-remote503', 'device');
        expect(
          (await hub.maybeForward(call.req, call.url, call.body))?.status,
        ).toBe(503);
        expect(remote.served).toHaveLength(1);
        expect(healthy.served).toEqual([]);
        expect(hub.capacityOverlay(ORG).placements).toEqual([
          { sessionId: 'pa-remote503', deviceId: 'dev-remote' },
        ]);
      } finally {
        hub.stop();
      }
    },
  );

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

  test('reported memory headroom takes precedence over nominal free slots', async () => {
    const { hub } = await makeHub();
    const tight = connectDevice(hub, 'dev-tight');
    await tight.hello({ maxSessions: 20 });
    await tight.status({
      maxSessions: 20,
      resources: {
        memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 7.5 * 1024 ** 3 },
      },
    });
    const room = connectDevice(hub, 'dev-room');
    await room.hello();
    await room.status({
      running: 1,
      resources: {
        memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 2 * 1024 ** 3 },
      },
    });
    const call = createRequest('memory-choice', 'device');
    expect(
      (await hub.maybeForward(call.req, call.url, call.body))?.headers.get(
        DEVICE_HEADER,
      ),
    ).toBe('dev-room');
    expect(tight.served).toHaveLength(0);
  });

  test('concurrent retries of an id retain a single device even if its first answer is lost', async () => {
    const { hub } = await makeHub();
    const cut = connectDevice(hub, 'dev-cut', (s) =>
      s.reset('internal', 'lost answer'),
    );
    await cut.hello();
    const fine = connectDevice(hub, 'dev-fine');
    await fine.hello();
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => {
        const call = createRequest('same-create', 'device');
        return hub.maybeForward(call.req, call.url, call.body);
      }),
    );
    expect(responses.map((res) => res?.status)).toEqual([503, 503, 503]);
    expect(cut.served).toHaveLength(3);
    expect(fine.served).toHaveLength(0);
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'same-create', deviceId: 'dev-cut' },
    ]);
  });

  test('a lost create answer keeps its placement and retries on that device', async () => {
    const { hub } = await makeHub();
    const draining = connectDevice(hub, 'dev-draining', (s) =>
      s.respond(
        { status: 429, headers: [['content-type', 'application/json']] },
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
    expect(res?.status).toBe(503);
    expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-cut');
    expect(fine.served).toHaveLength(0);
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-agent9', deviceId: 'dev-cut' },
    ]);
    const retry = createRequest('pa-agent9', 'device');
    expect(
      (await hub.maybeForward(retry.req, retry.url, retry.body))?.status,
    ).toBe(503);
    expect(cut.served).toHaveLength(2);
    expect(fine.served).toHaveLength(0);
  });

  test('an ambiguous create never falls back to the server', async () => {
    const { hub } = await makeHub();
    const cut = connectDevice(hub, 'dev-cut', (s) =>
      s.reset('internal', 'connection lost'),
    );
    await cut.hello();
    const { req, url, body } = createRequest('pa-agent10', 'device');
    expect((await hub.maybeForward(req, url, body))?.status).toBe(503);
    expect(cut.served).toHaveLength(1);
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-agent10', deviceId: 'dev-cut' },
    ]);
  });

  test('a failed create stays placed while its device sits out unrelated new sessions', async () => {
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
      expect(res?.headers.get(DEVICE_HEADER)).toBe(
        id === 'pa-b1' ? 'dev-broken' : 'dev-healthy',
      );
    }
    expect(broken.served).toHaveLength(1);
    expect(hub.capacityOverlay(ORG).placements.map((p) => p.deviceId)).toEqual([
      'dev-broken',
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

  test('a delayed destroy cannot forget a session recreated after another destroy completed', async () => {
    const { hub } = await makeHub();
    const held = Promise.withResolvers<IncomingStream>();
    let holdNextDestroy = true;
    const reply = (stream: IncomingStream) =>
      stream.respond(
        { status: stream.head.method === 'DELETE' ? 200 : 201, headers: [] },
        new Response(
          JSON.stringify({ destroyed: true, busy: false, deletion: 'done' }),
        ).body,
      );
    const device = connectDevice(hub, 'dev-1', (stream) => {
      if (stream.head.method === 'DELETE' && holdNextDestroy) {
        holdNextDestroy = false;
        held.resolve(stream);
      } else reply(stream);
    });
    await device.hello();
    const create = () => {
      const call = createRequest('pa-recreated', 'device');
      return hub.maybeForward(call.req, call.url, call.body);
    };
    const destroy = () => {
      const call = callRequest('DELETE', '/v1/sessions/pa-recreated');
      return hub.maybeForward(call.req, call.url, '');
    };
    await (await create())?.text();
    const delayed = destroy();
    const heldStream = await held.promise;
    await (await destroy())?.text();
    expect(hub.capacityOverlay(ORG).placements).toEqual([]);
    await (await create())?.text();
    reply(heldStream);
    await (await delayed)?.text();
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-recreated', deviceId: 'dev-1' },
    ]);
  });

  // The cleanup after a failed create stops a session and keeps its
  // workspace on the device: its id must still reach that device.
  test('a stop that kept the workspace leaves the placement as it was', async () => {
    const { hub } = await makeHub();
    const device = connectDevice(hub, 'dev-1', (stream) =>
      stream.respond(
        { status: stream.head.method === 'DELETE' ? 200 : 201, headers: [] },
        new Response(
          JSON.stringify(
            stream.head.method === 'DELETE'
              ? { stopped: true, busy: false, workspaceKept: true }
              : {},
          ),
        ).body,
      ),
    );
    await device.hello();
    const create = createRequest('pa-kept', 'device');
    await (await hub.maybeForward(create.req, create.url, create.body))?.text();
    const stop = callRequest(
      'DELETE',
      '/v1/sessions/pa-kept?if_idle=1&keep_workspace=1',
    );
    const answer = await hub.maybeForward(stop.req, stop.url, '');
    expect(await answer?.json()).toEqual({
      stopped: true,
      busy: false,
      workspaceKept: true,
    });
    expect(
      device.served.some(
        (call) =>
          call.method === 'DELETE' &&
          call.path === '/v1/sessions/pa-kept?if_idle=1&keep_workspace=1',
      ),
    ).toBe(true);
    expect(hub.capacityOverlay(ORG).placements).toEqual([
      { sessionId: 'pa-kept', deviceId: 'dev-1' },
    ]);
    // The next call for the id still goes to the device.
    const again = callRequest('GET', '/v1/sessions/pa-kept');
    expect(await hub.maybeForward(again.req, again.url, '')).not.toBeNull();
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

  test('a placement a plain if_idle destroy left deleting ends once the device has deleted the bytes, though nobody asks for the id again', async () => {
    let now = 1_800_000_000_000;
    const { hub } = await makeHub({ now: () => now });
    let deletion = 'pending';
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      if (s.head.method === 'DELETE') {
        s.respond(
          { status: 200, headers: [['content-type', 'application/json']] },
          new Response(
            JSON.stringify({ destroyed: false, busy: false, deletion }),
          ).body,
        );
        return;
      }
      s.respond(
        { status: 201, headers: [['content-type', 'application/json']] },
        new Response('{}').body,
      );
    });
    await d1.hello();
    const create = createRequest('wf-run-1', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    // The run ended: its reclaim is a plain `if_idle` destroy, answered
    // right after the rename, and the platform settles its row. A run id
    // is never destroyed or created again.
    const reclaim = callRequest('DELETE', '/v1/sessions/wf-run-1?if_idle=1');
    await (await hub.maybeForward(reclaim.req, reclaim.url, ''))?.text();
    const routed = async () => {
      const read = callRequest('GET', '/v1/sessions/wf-run-1');
      return (await hub.maybeForward(read.req, read.url, '')) !== null;
    };
    const asks = () =>
      d1.served.filter(
        (call) =>
          call.method === 'DELETE' &&
          call.path ===
            '/v1/sessions/wf-run-1?if_idle=1&if_stopped=1&await_deletion=1',
      ).length;
    // The hub asks the device itself — the cleanup's conditional destroy,
    // which never touches a session or a create under way — and not more
    // often than its interval.
    await hub.recheckDeleting();
    await hub.recheckDeleting();
    expect(asks()).toBe(1);
    expect(await routed()).toBe(true);
    // Done on the device: the next ask lets the route go.
    deletion = 'done';
    now += 5 * 60_000;
    await hub.recheckDeleting();
    expect(asks()).toBe(2);
    expect(await routed()).toBe(false);
  });

  test('a route stays while its device still says the bytes are there, or cannot say', async () => {
    let now = 1_800_000_000_000;
    const { hub } = await makeHub({ now: () => now });
    // The reclaim, then the hub's own asks: still deleting, failing, and an
    // answer without a state (the device rolled back to an older release).
    const answers: Array<Record<string, unknown>> = [
      { destroyed: true, busy: false, deletion: 'pending' },
      { destroyed: false, busy: false, deletion: 'pending' },
      { destroyed: false, busy: false, deletion: 'failed' },
      { destroyed: false, busy: false },
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
    const create = createRequest('pa-held', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    const reclaim = callRequest('DELETE', '/v1/sessions/pa-held?if_idle=1');
    await (await hub.maybeForward(reclaim.req, reclaim.url, ''))?.text();
    for (let ask = 0; ask < 3; ask++) {
      now += 5 * 60_000;
      await hub.recheckDeleting();
    }
    // An erasure's Retry still reaches the device that holds the bytes.
    const retry = callRequest(
      'DELETE',
      '/v1/sessions/pa-held?if_idle=1&if_stopped=1&await_deletion=1',
    );
    const answer = await hub.maybeForward(retry.req, retry.url, '');
    expect(await answer?.json()).toMatchObject({ deletion: 'done' });
    expect(d1.served.filter((call) => call.method === 'DELETE')).toHaveLength(
      5,
    );
    // Confirmed: nothing routes there any more, and nothing is asked again.
    now += 5 * 60_000;
    await hub.recheckDeleting();
    const again = callRequest('DELETE', '/v1/sessions/pa-held');
    expect(await hub.maybeForward(again.req, again.url, '')).toBeNull();
    expect(d1.served.filter((call) => call.method === 'DELETE')).toHaveLength(
      5,
    );
  });

  test('a create sent back to a device still deleting the id falls back like any create when that device cannot take it', async () => {
    const { hub } = await makeHub();
    let refuseCreates = false;
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      if (s.head.method === 'DELETE') {
        s.respond(
          { status: 200, headers: [['content-type', 'application/json']] },
          new Response(
            JSON.stringify({
              destroyed: true,
              busy: false,
              deletion: 'pending',
            }),
          ).body,
        );
        return;
      }
      // Later on: draining, or its Docker cannot start the session.
      s.respond(
        {
          status: refuseCreates ? 429 : 201,
          headers: [['content-type', 'application/json']],
        },
        new Response('{}').body,
      );
    });
    await d1.hello();
    const create = () => {
      const call = createRequest('pa-fall', 'device');
      return hub.maybeForward(call.req, call.url, call.body);
    };
    expect((await create())?.headers.get(DEVICE_HEADER)).toBe('dev-1');
    const destroy = callRequest('DELETE', '/v1/sessions/pa-fall');
    await (await hub.maybeForward(destroy.req, destroy.url, ''))?.text();
    const d2 = connectDevice(hub, 'dev-2');
    await d2.hello();
    refuseCreates = true;
    // dev-1 is tried first — it holds the old bytes — and its refusal falls
    // back on the next device, as for any create: a new session never fails
    // for an old workspace's bytes.
    const res = await create();
    expect(res?.status).toBe(201);
    expect(res?.headers.get(DEVICE_HEADER)).toBe('dev-2');
    expect(
      d1.served.filter((call) => call.method === 'POST').map((c) => c.path),
    ).toEqual(['/v1/sessions', '/v1/sessions']);
  });

  test('a device that hands the volume off releases the route, and a destroyed session it still reports is no runtime session', async () => {
    const { hub } = await makeHub();
    let deletion = 'pending';
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      if (s.head.method === 'DELETE') {
        s.respond(
          { status: 200, headers: [['content-type', 'application/json']] },
          new Response(
            JSON.stringify({ destroyed: true, busy: false, deletion }),
          ).body,
        );
        return;
      }
      s.respond(
        { status: 201, headers: [['content-type', 'application/json']] },
        new Response('{}').body,
      );
    });
    await d1.hello();
    const create = createRequest('pa-k8s', 'device');
    await hub.maybeForward(create.req, create.url, create.body);
    const destroy = async () => {
      const call = callRequest('DELETE', '/v1/sessions/pa-k8s');
      return hub.maybeForward(call.req, call.url, '');
    };
    await (await destroy())?.text();
    // A status sent before the destroy still lists the session: it is not
    // running any more, whatever the report says.
    await d1.status({
      running: 1,
      sessions: [{ sessionId: 'pa-k8s', state: 'running' }],
    });
    expect(hub.capacityOverlay(ORG).runtimeSessions).toEqual([]);
    deletion = 'handed_off';
    await (await destroy())?.text();
    expect(await destroy()).toBeNull();
  });

  test.each([
    { answer: 'done', sweep: false },
    { answer: 'pending', sweep: false },
    { answer: 'done', sweep: true },
  ])(
    'a create during durable destroy finalization keeps its route (%j)',
    async ({ answer, sweep }) => {
      const { hub } = await makeHub();
      let deletion = sweep ? 'pending' : answer;
      const device = connectDevice(hub, 'dev-1', (stream) => {
        stream.respond(
          { status: stream.head.method === 'DELETE' ? 200 : 201, headers: [] },
          new Response(
            JSON.stringify(
              stream.head.method === 'DELETE'
                ? { destroyed: true, busy: false, deletion }
                : {},
            ),
          ).body,
        );
      });
      await device.hello();
      const create = () => {
        const call = createRequest('pa-finalize', 'device');
        return hub.maybeForward(call.req, call.url, call.body);
      };
      const destroy = () => {
        const call = callRequest('DELETE', '/v1/sessions/pa-finalize');
        return hub.maybeForward(call.req, call.url, '');
      };
      await (await create())?.text();
      if (sweep) await (await destroy())?.text();
      deletion = answer;
      // Hold the disk write after the destroy's create-generation check. A
      // create must not reuse the still-visible old route inside this window.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- hold a private disk write after the real destroy response
      const store = PlacementStore.prototype as unknown as {
        writeSnapshot: (
          placements: ReadonlyMap<string, unknown>,
        ) => Promise<void>;
      };
      const write = store.writeSnapshot;
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let hold = true;
      store.writeSnapshot = async function (this: unknown, placements) {
        if (hold) {
          hold = false;
          entered.resolve();
          await release.promise;
        }
        return write.call(this, placements);
      };
      try {
        const destroying = sweep ? hub.recheckDeleting() : destroy();
        await entered.promise;
        const creating = create();
        await Bun.sleep(20);
        const createsBeforeCommit = device.served.filter(
          (call) => call.method === 'POST',
        ).length;
        release.resolve();
        await destroying;
        expect((await creating)?.status).toBe(201);
        expect(createsBeforeCommit).toBe(1);
        expect(hub.capacityOverlay(ORG).placements).toEqual([
          { sessionId: 'pa-finalize', deviceId: 'dev-1' },
        ]);
        const read = callRequest('GET', '/v1/sessions/pa-finalize');
        expect(
          (await hub.maybeForward(read.req, read.url, ''))?.headers.get(
            DEVICE_HEADER,
          ),
        ).toBe('dev-1');
      } finally {
        release.resolve();
        store.writeSnapshot = write;
      }
    },
  );

  for (const answer of ['pending', 'done'] as const) {
    test(`an ask answered ${answer} while a create under the id writes its placement leaves the new session's route alone`, async () => {
      let now = 1_800_000_000_000;
      const { hub } = await makeHub({ now: () => now });
      let holdNextDelete = false;
      let answerHeldAsk: () => void = () => {};
      const d1 = connectDevice(hub, 'dev-1', (s) => {
        if (s.head.method !== 'DELETE') {
          s.respond(
            { status: 201, headers: [['content-type', 'application/json']] },
            new Response('{}').body,
          );
          return;
        }
        const reply = (deletion: string) =>
          s.respond(
            { status: 200, headers: [['content-type', 'application/json']] },
            new Response(
              JSON.stringify({ destroyed: false, busy: false, deletion }),
            ).body,
          );
        if (holdNextDelete) {
          holdNextDelete = false;
          answerHeldAsk = () => reply(answer);
          return;
        }
        reply('pending');
      });
      await d1.hello();
      const create = () => {
        const call = createRequest('pa-again', 'device');
        return hub.maybeForward(call.req, call.url, call.body);
      };
      const asks = () =>
        d1.served.filter((call) => call.path.includes('if_stopped=1')).length;
      await create();
      const destroy = callRequest('DELETE', '/v1/sessions/pa-again');
      await (await hub.maybeForward(destroy.req, destroy.url, ''))?.text();

      // The hub's ask is on its way to dev-1, and held there.
      holdNextDelete = true;
      const asking = hub.recheckDeleting();
      await Bun.sleep(20);
      expect(asks()).toBe(1);
      // A new session under the id starts, and its placement write is held:
      // the window between the placement and the file.
      // The store's private file write, held open from outside.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the write is private; the test holds it
      const store = PlacementStore.prototype as unknown as {
        writeSnapshot: (
          placements: ReadonlyMap<string, unknown>,
        ) => Promise<void>;
      };
      const write = store.writeSnapshot;
      const written = Promise.withResolvers<void>();
      store.writeSnapshot = async function (this: unknown, placements) {
        await written.promise;
        return write.call(this, placements);
      };
      try {
        const creating = create();
        await Bun.sleep(20);
        // The ask's answer lands inside that window.
        answerHeldAsk();
        await Bun.sleep(20);
        written.resolve();
        expect((await creating)?.status).toBe(201);
        await asking;
      } finally {
        store.writeSnapshot = write;
      }
      // The answer was about the old bytes, not the new session: its route
      // stands, as a session, and nothing asks about it.
      expect(hub.capacityOverlay(ORG).placements).toEqual([
        { sessionId: 'pa-again', deviceId: 'dev-1' },
      ]);
      now += 5 * 60_000;
      await hub.recheckDeleting();
      expect(asks()).toBe(1);
    });
  }

  test('a backlog of deleting placements is asked about 8 a sweep, least recently asked first, so none starves', async () => {
    let now = 1_800_000_000_000;
    const { hub } = await makeHub({ now: () => now });
    const d1 = connectDevice(hub, 'dev-1', (s) => {
      s.respond(
        {
          status: s.head.method === 'DELETE' ? 200 : 201,
          headers: [['content-type', 'application/json']],
        },
        new Response(
          JSON.stringify({ destroyed: false, busy: false, deletion: 'failed' }),
        ).body,
      );
    });
    await d1.hello({ maxSessions: 256 });
    const ids = Array.from({ length: 90 }, (_, i) => `wf-run-${i}`);
    for (const id of ids) {
      const call = createRequest(id, 'device');
      await hub.maybeForward(call.req, call.url, call.body);
      const destroy = callRequest('DELETE', `/v1/sessions/${id}`);
      await (await hub.maybeForward(destroy.req, destroy.url, ''))?.text();
    }
    const asked = () =>
      new Set(
        d1.served
          .filter((call) => call.path.includes('if_stopped=1'))
          .map((call) => call.path.split('?')[0]),
      );
    const askCount = () =>
      d1.served.filter((call) => call.path.includes('if_stopped=1')).length;
    await hub.recheckDeleting();
    expect(askCount()).toBe(8);
    // Ten more minutes of sweeps: past the first 80, the rest are reached
    // too, though the first ones are due again by then.
    for (let sweep = 0; sweep < 20; sweep++) {
      now += 30_000;
      await hub.recheckDeleting();
    }
    expect(asked().size).toBe(90);
  });

  /** A device on dev-1 whose destroys answer `pending`, then whatever
   * `later` says; `pa-x` placed there and destroyed, so its placement is
   * deleting. */
  async function deletingOnDev1(
    overrides: Partial<HubOptions> = {},
    later = 'done',
  ) {
    const made = await makeHub(overrides);
    let destroys = 0;
    const device = connectDevice(made.hub, 'dev-1', (s) => {
      if (s.head.method !== 'DELETE') {
        s.respond(
          { status: 201, headers: [['content-type', 'application/json']] },
          new Response('{}').body,
        );
        return;
      }
      destroys++;
      s.respond(
        { status: 200, headers: [['content-type', 'application/json']] },
        new Response(
          JSON.stringify({
            destroyed: destroys === 1,
            busy: false,
            deletion: destroys === 1 ? 'pending' : later,
          }),
        ).body,
      );
    });
    await device.hello();
    const create = createRequest('pa-x', 'device');
    await made.hub.maybeForward(create.req, create.url, create.body);
    const destroy = callRequest('DELETE', '/v1/sessions/pa-x');
    await (await made.hub.maybeForward(destroy.req, destroy.url, ''))?.text();
    const routed = async () => {
      const read = callRequest('GET', '/v1/sessions/pa-x');
      return (await made.hub.maybeForward(read.req, read.url, '')) !== null;
    };
    const asks = () =>
      device.served.filter((call) => call.path.includes('if_stopped=1')).length;
    return { ...made, device, routed, asks };
  }

  test('a device on another release is not asked: its answer could not confirm anything', async () => {
    const { hub, routed, asks } = await deletingOnDev1();
    // dev-1 comes back on another release; the hub still routes to it.
    const again = connectDevice(hub, 'dev-1');
    await again.hello({ version: '0.5.59' });
    await hub.recheckDeleting();
    expect(asks()).toBe(0);
    expect(again.served.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(await routed()).toBe(true);
  });

  test('the sweep asks on its own, with nobody calling it', async () => {
    const { hub, routed, asks } = await deletingOnDev1({
      sweepIntervalMs: 20,
    });
    await Bun.sleep(200);
    hub.stop();
    expect(asks()).toBe(1);
    expect(await routed()).toBe(false);
  });

  test('a create under a deleting id that the server takes lets the route to the old bytes go', async () => {
    const { hub, routed } = await deletingOnDev1();
    // Not for a device: the session lives on the server now, so no call
    // under the id may still go to dev-1.
    const create = createRequest('pa-x');
    expect(
      await hub.maybeForward(create.req, create.url, create.body),
    ).toBeNull();
    expect(await routed()).toBe(false);
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
