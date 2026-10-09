import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it as test } from 'node:test';

import {
  createLazyDockerProxy,
  type EngineHandle,
  engineIsIdle,
  trimIdleEngineStore,
} from './lazy-docker';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await delay(10);
  assert.equal(predicate(), true);
}
async function fixture(
  options: {
    idle?: () => Promise<boolean>;
    beforeStop?: () => Promise<void>;
    failFirst?: boolean;
    maxClients?: number;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'tale-lazy-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const publicSocket = join(dir, 'public.sock');
  const privateSocket = join(dir, 'private.sock');
  let starts = 0;
  let stops = 0;
  const engineSockets = new Set<Socket>();
  const proxy = await createLazyDockerProxy({
    publicSocket,
    privateSocket,
    idleMs: 35,
    retryIdleMs: 20,
    maxClients: options.maxClients ?? 16,
    canStop: options.idle ?? (async () => true),
    ...(options.beforeStop ? { beforeStop: options.beforeStop } : {}),
    startEngine: async (): Promise<EngineHandle> => {
      starts++;
      await delay(15);
      if (options.failFirst && starts === 1) throw new Error('start failed');
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        engineSockets.add(socket);
        socket.on('close', () => engineSockets.delete(socket));
        socket.pipe(socket);
      });
      await new Promise<void>((resolve) =>
        server.listen(privateSocket, resolve),
      );
      let exited!: () => void;
      const exit = new Promise<void>((resolve) => {
        exited = resolve;
      });
      return {
        exited: exit,
        stop: async () => {
          stops++;
          for (const socket of engineSockets) socket.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          exited();
        },
      };
    },
  });
  cleanups.push(() => proxy.close());
  function connect() {
    const socket = createConnection(publicSocket);
    socket.on('error', () => {});
    cleanups.push(async () => {
      socket.destroy();
    });
    return socket;
  }
  async function echo(socket: Socket, text: string) {
    const result = new Promise<string>((resolve, reject) => {
      socket.once('data', (data) => resolve(data.toString()));
      socket.once('error', reject);
    });
    socket.write(text);
    assert.equal(await result, text);
  }
  return { proxy, connect, echo, starts: () => starts, stops: () => stops };
}

void describe('automatic Docker socket activation', () => {
  void test('starts only on demand, singleflights concurrent clients, idles and starts again', async () => {
    const f = await fixture();
    await delay(60);
    assert.equal(f.starts(), 0);
    const a = f.connect();
    const b = f.connect();
    await Promise.all([
      f.echo(a, 'GET /_ping HTTP/1.1\r\n\r\n'),
      f.echo(b, 'upgrade\0binary'),
    ]);
    assert.equal(f.starts(), 1);
    await delay(90);
    assert.equal(f.stops(), 0);
    a.destroy();
    b.destroy();
    await until(() => f.stops() === 1);
    const c = f.connect();
    await f.echo(c, 'second engine');
    assert.equal(f.starts(), 2);
  });

  void test('slow readers receive every byte through half-closed upgraded streams', async () => {
    const f = await fixture();
    const socket = f.connect();
    await f.echo(socket, 'HTTP/1.1 101 UPGRADED\r\n\r\n');
    const input = Buffer.alloc(256 * 1024, 137);
    const expected = createHash('sha256');
    const actual = createHash('sha256');
    let bytes = 0;
    socket.on('data', (chunk) => {
      bytes += chunk.length;
      actual.update(chunk);
      socket.pause();
      setTimeout(() => socket.resume(), 1);
    });
    const ended = once(socket, 'end');
    for (let i = 0; i < 32; i++) {
      expected.update(input);
      if (!socket.write(input)) await once(socket, 'drain');
    }
    socket.end();
    await ended;
    assert.equal(bytes, 8 * 1024 * 1024);
    assert.equal(actual.digest('hex'), expected.digest('hex'));
  });

  void test('failed startup closes waiting sockets and a later request retries', async () => {
    const f = await fixture({ failFirst: true });
    const a = f.connect();
    await new Promise<void>((resolve) => a.once('close', () => resolve()));
    const b = f.connect();
    await f.echo(b, 'retry');
    assert.equal(f.starts(), 2);
  });

  void test('running containers and failed inventory keep the engine alive', async () => {
    let checks = 0;
    const f = await fixture({
      idle: async () => {
        checks++;
        if (checks % 2) throw new Error('unavailable');
        return false;
      },
    });
    const a = f.connect();
    await f.echo(a, 'active containers');
    a.destroy();
    await until(() => checks >= 2);
    assert.equal(f.stops(), 0);
  });

  void test('a new request during the asynchronous idle check fences off the stop', async () => {
    let finishCheck!: (idle: boolean) => void;
    const f = await fixture({
      idle: () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        }),
    });
    const a = f.connect();
    await f.echo(a, 'first');
    a.destroy();
    await until(() => Boolean(finishCheck));
    const b = f.connect();
    await f.echo(b, 'race');
    finishCheck(true);
    await delay(50);
    assert.equal(f.stops(), 0);
  });

  void test('trims an idle engine before stopping it, and a client during the trim keeps it running', async (context) => {
    const events: string[] = [];
    let finishTrim!: () => void;
    let trims = 0;
    const f = await fixture({
      beforeStop: () => {
        trims++;
        events.push('trim');
        if (trims === 1)
          return new Promise<void>((resolve) => {
            finishTrim = resolve;
          });
        if (trims === 2) return Promise.reject(new Error('prune failed'));
        return Promise.resolve();
      },
    });
    const warn = context.mock.method(console, 'warn', () => {});
    const a = f.connect();
    await f.echo(a, 'first');
    a.destroy();
    await until(() => trims === 1);
    const b = f.connect();
    await f.echo(b, 'during trim');
    finishTrim();
    await delay(50);
    assert.equal(f.stops(), 0);
    b.destroy();
    // The next idle check trims again; a failing trim still stops the engine.
    await until(() => f.stops() === 1);
    assert.deepEqual(events, ['trim', 'trim']);
    assert.equal(warn.mock.callCount(), 1);
    assert.equal(f.starts(), 1);
  });

  void test('bounds connected clients while preserving existing streams', async () => {
    const f = await fixture({ maxClients: 1 });
    const a = f.connect();
    await f.echo(a, 'one');
    const b = f.connect();
    await new Promise<void>((resolve) => b.once('close', () => resolve()));
    await f.echo(a, 'still live');
    assert.equal(f.starts(), 1);
  });
});

void describe('idle inventory', () => {
  void test('negotiates the API and refuses unknown, paused or running states', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-inventory-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const socket = join(dir, 'docker.sock');
    let state = 'exited';
    let policy = 'no';
    const containerId = 'a'.repeat(64);
    const requests: string[] = [];
    const server = createServer((connection) => {
      connection.once('data', (request) => {
        const path = request.toString().split(' ')[1] ?? '';
        requests.push(path);
        const body = JSON.stringify(
          path === '/version'
            ? { ApiVersion: '1.53' }
            : path.endsWith('/json?all=true')
              ? [{ State: state, Id: containerId }]
              : { HostConfig: { RestartPolicy: { Name: policy } } },
        );
        connection.end(
          `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    assert.equal(await engineIsIdle(socket), true);
    assert.deepEqual(requests, [
      '/version',
      '/v1.53/containers/json?all=true',
      `/v1.53/containers/${containerId}/json`,
    ]);
    for (const next of [
      'running',
      'paused',
      'restarting',
      'removing',
      'unknown',
    ]) {
      state = next;
      assert.equal(await engineIsIdle(socket), false);
    }
    state = 'exited';
    for (const next of ['always', 'unless-stopped', 'on-failure', 'unknown']) {
      policy = next;
      assert.equal(await engineIsIdle(socket), false);
    }
  });
});

void describe('idle store trim', () => {
  async function engine(
    responses: (
      method: string,
      path: string,
    ) => { status?: number; body: unknown },
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'tale-trim-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const socket = join(dir, 'docker.sock');
    const requests: string[] = [];
    const server = createServer((connection) => {
      connection.once('data', (request) => {
        const [method = '', path = ''] = request.toString().split(' ');
        requests.push(`${method} ${path}`);
        const { status = 200, body } = responses(method, path);
        const text = JSON.stringify(body);
        connection.end(
          `HTTP/1.1 ${status} X\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    return { socket, requests };
  }
  const GIB = 1024 ** 3;
  const quiet = { log: () => {}, warn: () => {} };

  void test('a store within the threshold is only measured', async () => {
    const e = await engine((_, path) => ({
      body:
        path === '/version'
          ? { ApiVersion: '1.55' }
          : {
              ImageUsage: { TotalSize: 6 * GIB },
              BuildCacheUsage: { TotalSize: 3 * GIB },
            },
    }));
    const result = await trimIdleEngineStore(e.socket, quiet);
    assert.deepEqual(result, { usedBytes: 9 * GIB });
    assert.deepEqual(e.requests, [
      'GET /version',
      'GET /v1.55/system/df?type=image&type=build-cache',
    ]);
  });

  void test('a store over the threshold loses dangling images and old build cache, logged', async () => {
    const e = await engine((_, path) => ({
      body:
        path === '/version'
          ? { ApiVersion: '1.55' }
          : path.includes('/system/df')
            ? {
                ImageUsage: { TotalSize: 9 * GIB },
                BuildCacheUsage: { TotalSize: 3 * GIB },
              }
            : { SpaceReclaimed: GIB },
    }));
    const logs: string[] = [];
    const result = await trimIdleEngineStore(e.socket, {
      ...quiet,
      log: (message) => logs.push(message),
    });
    assert.deepEqual(result, { usedBytes: 12 * GIB, reclaimedBytes: 2 * GIB });
    assert.deepEqual(e.requests.slice(2), [
      `POST /v1.55/images/prune?filters=${encodeURIComponent('{"dangling":["true"]}')}`,
      `POST /v1.55/build/prune?reserved-space=${5 * GIB}&max-used-space=${5 * GIB}`,
    ]);
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? '', /used 12\.0 GiB .* reclaimed 2\.0 GiB/);
  });

  void test('older engines report records and take keep-storage; one failed prune does not stop the other', async () => {
    const e = await engine((method, path) => {
      if (path === '/version') return { body: { ApiVersion: '1.47' } };
      if (path.includes('/system/df'))
        return {
          body: {
            LayersSize: 10 * GIB,
            BuildCache: [{ Size: GIB }, { Size: GIB }, { Size: 'bad' }],
          },
        };
      if (method === 'POST' && path.includes('/images/prune'))
        return { status: 500, body: { message: 'busy' } };
      return { body: { SpaceReclaimed: GIB } };
    });
    const warnings: string[] = [];
    const result = await trimIdleEngineStore(e.socket, {
      ...quiet,
      warn: (message) => warnings.push(message),
    });
    assert.deepEqual(result, { usedBytes: 12 * GIB, reclaimedBytes: GIB });
    assert.equal(
      e.requests.at(-1),
      `POST /v1.47/build/prune?keep-storage=${5 * GIB}`,
    );
    assert.deepEqual(warnings, ['[lazy-docker] dangling image prune failed:']);
  });

  void test('an unreadable usage answer prunes nothing', async () => {
    const e = await engine((_, path) => ({
      body: path === '/version' ? { ApiVersion: '1.55' } : { Images: [] },
    }));
    await assert.rejects(
      trimIdleEngineStore(e.socket, quiet),
      /no image total/,
    );
    assert.equal(e.requests.length, 2);
  });
});
