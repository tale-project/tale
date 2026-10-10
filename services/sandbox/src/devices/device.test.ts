import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DeviceConfig } from './device-config.ts';
import {
  DeviceAgent,
  DeviceRevokedError,
  effectiveUpdate,
  type DeviceObservation,
  type WebSocketLike,
} from './device.ts';
import { DEVICE_HEADER, DeviceHub, serveHub, TUNNEL_PATH } from './hub.ts';
import { mintDeviceTicket } from './ticket.ts';

const TOKEN = 'device-test-token';
const ORG = 'org_device_test';
const DEVICE_ID = 'dev-e2e';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setup(opts: {
  serverVersion?: string;
  deviceVersion?: string;
  ticketStatus?: number;
  observe?: () => Promise<DeviceObservation>;
  inventoryKey?: () => string;
}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'tale-device-'));
  cleanups.push(() => rm(stateDir, { recursive: true, force: true }));
  const upstream: string[] = [];
  const hub = new DeviceHub({
    token: TOKEN,
    version: opts.serverVersion ?? '0.5.60',
    stateDir: join(stateDir, 'hub'),
    relays: {
      api: 'http://backend-api:3005',
      gateway: 'http://sandbox-llm-gateway:8080',
    },
    isLocalSession: () => Promise.resolve(false),
    fetch: (url) => {
      upstream.push(url);
      return Promise.resolve(Response.json({ data: [{ id: 'model-a' }] }));
    },
  });
  await hub.start();
  const door = serveHub(hub, 0);
  cleanups.push(() => {
    hub.stop();
    void door.stop(true);
  });

  const config: DeviceConfig = {
    version: 1,
    serverUrl: 'https://tale.example',
    deviceId: DEVICE_ID,
    deviceSecret: 'tsd_secret',
    organizationId: ORG,
    name: 'test-box',
    localToken: 'local',
    stateDir,
    maxSessions: 3,
    registry: 'ghcr.io/tale-project/tale',
    autoUpdate: true,
    relays: [],
    host: { os: 'linux', arch: 'x64', hostname: 'test-box' },
  };
  const ticketRequests: Array<{
    url: string;
    auth: string | null;
    body: unknown;
  }> = [];
  const updates: string[] = [];
  const dispatched: Array<{ method: string; path: string; body: string }> = [];
  const agent = new DeviceAgent({
    config,
    version: opts.deviceVersion ?? '0.5.60',
    maxRequestBodyBytes: 1024 * 1024,
    platform: () =>
      Promise.resolve({
        os: 'linux',
        arch: 'x64',
        cpus: 8,
        memoryBytes: 16 * 1024 ** 3,
        dockerVersion: '27.0.0',
      }),
    fetch: async (url, init) => {
      ticketRequests.push({
        url,
        auth: new Headers(init.headers).get('authorization'),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      });
      if (opts.ticketStatus !== undefined) {
        return new Response(
          opts.ticketStatus === 401
            ? JSON.stringify({ error: 'removed', code: 'DEVICE_REVOKED' })
            : 'Blocked request. This host is not allowed.',
          { status: opts.ticketStatus },
        );
      }
      return Response.json({
        ticket: mintDeviceTicket(
          {
            deviceId: DEVICE_ID,
            organizationId: ORG,
            issuedAtMs: Date.now(),
            expiresAtMs: Date.now() + 900_000,
          },
          TOKEN,
        ),
        tunnelUrl: `ws://127.0.0.1:${door.port}${TUNNEL_PATH}`,
        serverVersion: opts.serverVersion ?? '0.5.60',
      });
    },
    dispatch: async (req, url, body) => {
      dispatched.push({
        method: req.method,
        path: url.pathname + url.search,
        body,
      });
      if (url.pathname.endsWith('/exec')) {
        const enc = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(
                enc.encode('event: stdout\ndata: {"text":"hi"}\n\n'),
              );
              await new Promise((r) => setTimeout(r, 30));
              controller.enqueue(
                enc.encode('event: result\ndata: {"status":"completed"}\n\n'),
              );
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return Response.json(
        { session: { sessionId: 'pa-e2e', state: 'ready' } },
        { status: 201 },
      );
    },
    observe:
      opts.observe ??
      (() =>
        Promise.resolve({
          running: 0,
          starting: 0,
          sessions: [],
          resources: {
            cpu: { totalCores: 8, usedCores: 1 },
            memory: { totalBytes: 16 * 1024 ** 3, usedBytes: 4 * 1024 ** 3 },
          },
        })),
    ...(opts.inventoryKey ? { inventoryKey: opts.inventoryKey } : {}),
    selfUpdate: (version) => {
      updates.push(version);
      return Promise.resolve();
    },
  });
  void agent.start();
  cleanups.push(() => agent.stop());
  return { hub, agent, ticketRequests, updates, dispatched, upstream };
}

describe('device mode over a real WebSocket', () => {
  test('connects with a platform-minted ticket and serves the forwarded session API', async () => {
    const { hub, agent, ticketRequests, dispatched } = await setup({});
    await until(
      () => hub.devicesFor(ORG).length === 1,
      'the device to connect',
    );
    await until(() => agent.connected, 'the WELCOME');
    expect(ticketRequests[0]).toMatchObject({
      url: 'https://tale.example/api/sandbox-devices/ticket',
      auth: 'Bearer tsd_secret',
      body: { version: '0.5.60', maxSessions: 3, platform: { cpus: 8 } },
    });
    expect(hub.devicesFor(ORG)[0]).toMatchObject({
      deviceId: DEVICE_ID,
      compatible: true,
      platform: { os: 'linux', memoryBytes: 16 * 1024 ** 3 },
    });

    const body = JSON.stringify({
      sessionId: 'pa-e2e',
      organizationId: ORG,
      placement: 'device',
    });
    const create = await hub.maybeForward(
      new Request('http://sandbox/v1/sessions', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      }),
      new URL('http://sandbox/v1/sessions'),
      body,
    );
    expect(create?.status).toBe(201);
    expect(create?.headers.get(DEVICE_HEADER)).toBe(DEVICE_ID);
    expect(dispatched[0]).toEqual({
      method: 'POST',
      path: '/v1/sessions',
      body,
    });

    // A streamed exec crosses the tunnel intact, event by event.
    const exec = await hub.maybeForward(
      new Request('http://sandbox/v1/sessions/pa-e2e/exec', {
        method: 'POST',
        body: '{}',
      }),
      new URL('http://sandbox/v1/sessions/pa-e2e/exec'),
      '{}',
    );
    expect(exec?.headers.get('content-type')).toBe('text/event-stream');
    expect(await exec?.text()).toBe(
      'event: stdout\ndata: {"text":"hi"}\n\nevent: result\ndata: {"status":"completed"}\n\n',
    );
  });

  test("relays its sessions' gateway calls back through the hub", async () => {
    const { hub, agent, upstream } = await setup({});
    await until(
      () => agent.connected && hub.devicesFor(ORG).length === 1,
      'connection',
    );
    const res = await agent.relayRequest(
      'gateway',
      new Request('http://sandbox-llm-gateway:8080/openai/v1/models'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: 'model-a' }] });
    expect(upstream).toEqual([
      'http://sandbox-llm-gateway:8080/openai/v1/models',
    ]);
  });

  test('follows a newer server release by launching its updater', async () => {
    const { agent, updates } = await setup({
      serverVersion: '0.5.61',
      deviceVersion: '0.5.60',
    });
    await until(() => updates.length > 0, 'the update');
    expect(updates).toEqual(['0.5.61']);
    // On another release it still connects, but takes no new sessions.
    await until(() => agent.connected, 'connection');
  });

  test('a local build never auto-updates', async () => {
    const { agent, updates } = await setup({
      serverVersion: '0.5.61',
      deviceVersion: 'dev',
    });
    await until(() => agent.connected, 'connection');
    expect(updates).toEqual([]);
  });

  test('a refused credential reads as a removed device', async () => {
    const { agent } = await setup({ ticketStatus: 401 });
    expect(await agent.mintTicket().catch((e: unknown) => e)).toBeInstanceOf(
      DeviceRevokedError,
    );
    expect(agent.connected).toBe(false);
  });

  test('a proxy refusing the request is retried, never read as a removal', async () => {
    const { agent } = await setup({ ticketStatus: 403 });
    const err = await agent.mintTicket().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DeviceRevokedError);
    expect(String(err)).toContain('403');
    expect(String(err)).toContain('Blocked request');
  });

  test('its relays answer device_offline while the tunnel is down', async () => {
    const { agent } = await setup({ ticketStatus: 503 });
    const res = await agent.relayRequest(
      'api',
      new Request('http://backend-api:3005/api/tools/list'),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'device_offline' });
  });
});

describe('effectiveUpdate', () => {
  const at = 1_790_000_000_000;
  test('an update whose target runs here landed', () => {
    expect(
      effectiveUpdate(
        { state: 'updating', targetVersion: '0.5.61', error: null, atMs: at },
        '0.5.61',
        at + 60_000,
      ),
    ).toMatchObject({ state: 'idle' });
  });

  test('one still updating after half an hour did not finish', () => {
    expect(
      effectiveUpdate(
        { state: 'updating', targetVersion: '0.5.61', error: null, atMs: at },
        '0.5.60',
        at + 31 * 60_000,
      ),
    ).toMatchObject({
      state: 'failed',
      error: 'The update to 0.5.61 did not finish.',
    });
    // Still within its time: still updating.
    expect(
      effectiveUpdate(
        { state: 'updating', targetVersion: '0.5.61', error: null, atMs: at },
        '0.5.60',
        at + 60_000,
      ).state,
    ).toBe('updating');
  });
});

describe('device connection upkeep', () => {
  test('an upgrade nobody answers is given up on and dialled again', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'tale-device-'));
    cleanups.push(() => rm(stateDir, { recursive: true, force: true }));
    const sockets: Array<{ closed: boolean }> = [];
    const agent = new DeviceAgent({
      config: {
        version: 1,
        serverUrl: 'https://tale.example',
        deviceId: DEVICE_ID,
        deviceSecret: 'tsd_secret',
        organizationId: ORG,
        name: 'test-box',
        localToken: 'local',
        stateDir,
        maxSessions: 1,
        registry: 'ghcr.io/tale-project/tale',
        autoUpdate: false,
        relays: [],
        host: { os: 'linux', arch: 'x64', hostname: 'test-box' },
      },
      version: '0.5.60',
      maxRequestBodyBytes: 1024,
      connectTimeoutMs: 20,
      sleep: () => Promise.resolve(),
      platform: () =>
        Promise.resolve({
          os: 'linux',
          arch: 'x64',
          cpus: null,
          memoryBytes: null,
          dockerVersion: null,
        }),
      fetch: async () =>
        Response.json({
          ticket: 'tdt1.x.y',
          tunnelUrl: 'wss://tale.example/sandbox/tunnel',
          serverVersion: '0.5.60',
        }),
      // A proxy that accepted the connection and sits on the upgrade: the
      // socket never opens, and closing it fires nothing.
      connect: () => {
        const socket = { closed: false };
        sockets.push(socket);
        const fake: WebSocketLike = {
          binaryType: 'arraybuffer',
          bufferedAmount: 0,
          send: () => {},
          close: () => {
            socket.closed = true;
          },
          addEventListener: () => {},
        };
        return fake;
      },
      dispatch: () => Promise.resolve(new Response(null, { status: 404 })),
      observe: () =>
        Promise.resolve({
          running: 0,
          starting: 0,
          sessions: [],
          resources: {
            cpu: { totalCores: null, usedCores: null },
            memory: { totalBytes: null, usedBytes: null },
          },
        }),
      selfUpdate: () => Promise.resolve(),
    });
    void agent.start();
    cleanups.push(() => agent.stop());
    await until(() => sockets.length >= 2, 'a second dial');
    expect(sockets[0]?.closed).toBe(true);
  });

  test('a Docker that does not answer does not cost the tunnel', async () => {
    let observed = 0;
    // The first observation works (it announces the device); every later
    // one fails, as with a daemon too busy to answer `docker ps`.
    const { hub, agent } = await setup({
      observe: () => {
        observed += 1;
        return observed === 1
          ? Promise.resolve({
              running: 2,
              starting: 1,
              sessions: [],
              resources: {
                cpu: { totalCores: 8, usedCores: 1 },
                memory: { totalBytes: null, usedBytes: null },
              },
            })
          : Promise.reject(new Error('docker ps timed out'));
      },
    });
    // The report after WELCOME still went out, with what was last seen.
    await until(
      () => hub.devicesFor(ORG)[0]?.sessions.running === 2,
      'a status report',
    );
    expect(observed).toBeGreaterThanOrEqual(2);
    expect(hub.devicesFor(ORG)[0]?.sessions).toEqual({
      running: 2,
      starting: 1,
    });
    expect(agent.connected).toBe(true);
  });

  test('a change in its sessions is reported at once, not at the next heartbeat', async () => {
    let sessions: DeviceObservation['sessions'] = [];
    let observed = 0;
    const { hub, agent } = await setup({
      observe: () => {
        observed += 1;
        return Promise.resolve({
          running: sessions.filter((s) => s.state === 'running').length,
          starting: sessions.filter((s) => s.state === 'starting').length,
          sessions,
          resources: {
            cpu: { totalCores: 8, usedCores: null },
            memory: { totalBytes: null, usedBytes: null },
          },
        });
      },
      inventoryKey: () => JSON.stringify(sessions),
    });
    await until(() => agent.connected, 'the WELCOME');
    await until(
      () => hub.devicesFor(ORG)[0]?.sessions !== undefined,
      'a report',
    );
    const settled = observed;
    // Nothing changed: no report beyond the heartbeat (15 s away).
    await new Promise((r) => setTimeout(r, 1_500));
    expect(observed).toBe(settled);
    sessions = [{ sessionId: 'pa-change', state: 'starting' }];
    await until(
      () => hub.devicesFor(ORG)[0]?.sessions.starting === 1,
      'the change to be reported',
    );
    sessions = [{ sessionId: 'pa-change', state: 'running' }];
    await until(
      () => hub.devicesFor(ORG)[0]?.sessions.running === 1,
      'the next change to be reported',
    );
    expect(observed).toBe(settled + 2);
  });
});
