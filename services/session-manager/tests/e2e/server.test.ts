import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startE2eServer, type E2eServer } from './server.ts';

// The launcher runs one `startE2eServer` per Playwright worker in ONE process,
// so what a server holds (its fakes, its data directory, its control server)
// must belong to that call and to nothing the other calls can reach.

/** A page for the servers to serve: the only file `startReactServer` reads at boot. */
let page: string;
const started: E2eServer[] = [];

beforeAll(() => {
  page = mkdtempSync(join(tmpdir(), 'e2e-server-test-page-'));
  writeFileSync(join(page, 'index.html'), '<!doctype html><title>page</title>');
});

afterAll(() => {
  rmSync(page, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.stop()));
});

function portOf(socket: Server): number {
  const address = socket.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the socket has no port');
  }
  return address.port;
}

/** Ports nobody listens on right now. Asked for together, so that they differ. */
async function freePorts(count: number): Promise<number[]> {
  const sockets = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<Server>((resolve, reject) => {
          const socket = createServer();
          socket.once('error', reject);
          socket.listen(0, '127.0.0.1', () => resolve(socket));
        }),
    ),
  );
  const ports = sockets.map(portOf);
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.close(() => resolve());
        }),
    ),
  );
  return ports;
}

interface Running {
  server: E2eServer;
  origin: string;
  control: string;
}

function start(port: number, controlPort: number): Running {
  const server = startE2eServer({
    port,
    controlPort,
    launchDelayMs: 0,
    checkDelayMs: 0,
    distDir: page,
  });
  started.push(server);
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    control: `http://127.0.0.1:${controlPort}`,
  };
}

async function twoServers(): Promise<[Running, Running]> {
  const [port, controlPort, otherPort, otherControlPort] = await freePorts(4);
  if (
    port === undefined ||
    controlPort === undefined ||
    otherPort === undefined ||
    otherControlPort === undefined
  ) {
    throw new Error('no free ports');
  }
  return [start(port, controlPort), start(otherPort, otherControlPort)];
}

function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const proxiesSchema = z.array(
  z.object({ check: z.object({ status: z.string() }) }),
);
const sessionSchema = z.object({ id: z.number(), status: z.string() });

async function proxyChecks(origin: string): Promise<string[]> {
  const response = await call(origin, 'GET', '/api/proxies');
  return proxiesSchema
    .parse(await response.json())
    .map((proxy) => proxy.check.status);
}

const PROXY = { text: '203.0.113.9:8080', defaultScheme: 'http' };

/** Vitest polls for one second unless told otherwise: a loaded machine needs more. */
const WAIT = { timeout: 10_000 };

describe('startE2eServer', () => {
  it('serves its health route and the page on its own port, and tells where its data lives', async () => {
    const [{ server, origin, control }] = await twoServers();
    expect((await call(origin, 'GET', '/api/health')).status).toBe(200);
    expect((await call(origin, 'GET', '/')).status).toBe(200);
    expect((await call(control, 'DELETE', '/state')).status).toBe(200);
    expect(existsSync(server.dataDir)).toBe(true);
  });

  it('keeps the data of one server out of the other', async () => {
    const [a, b] = await twoServers();
    expect(
      (await call(a.origin, 'POST', '/api/proxies/import', PROXY)).status,
    ).toBe(200);
    await expect.poll(() => proxyChecks(a.origin), WAIT).toEqual(['ok']);
    expect(await proxyChecks(b.origin)).toEqual([]);
    expect(a.server.dataDir).not.toBe(b.server.dataDir);
  });

  it('gives each server fakes of its own: a scripted exit IP, a browser, a dialog', async () => {
    const [a, b] = await twoServers();

    // The checker: the same proxy fails on A, where the control server says so,
    // and works on B.
    await call(a.control, 'PUT', '/exit-ips', {
      '203.0.113.9:8080': { error: 'refused' },
    });
    await call(a.origin, 'POST', '/api/proxies/import', PROXY);
    await call(b.origin, 'POST', '/api/proxies/import', PROXY);
    await expect.poll(() => proxyChecks(a.origin), WAIT).toEqual(['failed']);
    await expect.poll(() => proxyChecks(b.origin), WAIT).toEqual(['ok']);

    // The browser: a session started on B has its fake browser on B's control
    // server and on no other.
    const created = await call(b.origin, 'POST', '/api/sessions', {
      name: 'solo',
      os: 'random',
    });
    expect(created.status).toBeLessThan(300);
    const session = sessionSchema.parse(await created.json());
    await expect
      .poll(async () => {
        const latest = await call(
          b.origin,
          'GET',
          `/api/sessions/${session.id}`,
        );
        return sessionSchema.parse(await latest.json()).status;
      }, WAIT)
      .toBe('running');
    expect((await call(b.control, 'GET', '/browsers/solo')).status).toBe(200);
    expect((await call(a.control, 'GET', '/browsers/solo')).status).toBe(404);

    // The page of that browser opens a dialog on B only.
    const dialog = await call(b.control, 'POST', '/browsers/solo/dialog', {
      kind: 'alert',
      message: 'hello',
    });
    expect(dialog.status).toBe(200);
    expect((await call(a.control, 'GET', '/browsers/solo')).status).toBe(404);
  });

  it('stops: its ports close, its data directory goes, and stopping again is harmless; the other keeps serving', async () => {
    const [a, b] = await twoServers();
    await a.server.stop();
    await a.server.stop();
    await expect(call(a.origin, 'GET', '/api/health')).rejects.toThrow();
    await expect(call(a.control, 'DELETE', '/state')).rejects.toThrow();
    expect(existsSync(a.server.dataDir)).toBe(false);
    expect((await call(b.origin, 'GET', '/api/health')).status).toBe(200);
    expect(existsSync(b.server.dataDir)).toBe(true);
  });

  it('releases its control port when the backend cannot listen', async () => {
    const [port, controlPort, otherPort, otherControlPort] = await freePorts(4);
    if (
      port === undefined ||
      controlPort === undefined ||
      otherPort === undefined ||
      otherControlPort === undefined
    ) {
      throw new Error('no free ports');
    }
    start(port, controlPort);
    // `port` is taken: the second server fails after its control server came up.
    expect(() =>
      startE2eServer({
        port,
        controlPort: otherControlPort,
        distDir: page,
      }),
    ).toThrow();
    // Its control port is free again for the next one.
    const next = start(otherPort, otherControlPort);
    expect((await call(next.control, 'DELETE', '/state')).status).toBe(200);
  });
});
