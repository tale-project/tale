import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it as test } from 'node:test';

import { InnerDockerHealth } from './inner-docker-health';
import { createLazyDockerProxy } from './lazy-docker';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await delay(10);
  assert.equal(predicate(), true);
}

async function fixture(
  options: {
    idleMs?: number;
    failFirst?: boolean;
    canStop?: () => Promise<boolean>;
    healthCacheMs?: number;
    healthNow?: () => number;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'tale-health-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const publicSocket = join(dir, 'docker.sock');
  const privateSocket = join(dir, 'engine.sock');
  const healthSocket = join(dir, 'health.sock');
  let starts = 0;
  let stops = 0;
  let pings = 0;
  let ping: (response: ServerResponse) => void = (res) => res.end('OK');
  let stopEngine = async () => {};
  const proxy = await createLazyDockerProxy({
    publicSocket,
    privateSocket,
    healthSocket,
    idleMs: options.idleMs ?? 60_000,
    canStop: options.canStop ?? (async () => true),
    startEngine: async () => {
      starts++;
      if (options.failFirst && starts === 1) throw new Error('start failed');
      const server = createServer((_req, res) => {
        pings++;
        ping(res);
      });
      await new Promise<void>((resolve) =>
        server.listen(privateSocket, resolve),
      );
      const exited = Promise.withResolvers<void>();
      stopEngine = async () => {
        stops++;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        exited.resolve();
      };
      return { exited: exited.promise, stop: stopEngine };
    },
  });
  cleanups.push(() => proxy.close());
  const health = new InnerDockerHealth(true, {
    socketPath: healthSocket,
    cacheMs: options.healthCacheMs ?? 0,
    now: options.healthNow,
    supervisor: true,
  });
  return {
    proxy,
    health,
    publicSocket,
    privateSocket,
    healthSocket,
    starts: () => starts,
    stops: () => stops,
    pings: () => pings,
    setPing: (handler: typeof ping) => {
      ping = handler;
    },
    crash: () => stopEngine(),
  };
}

void test('health polling never activates a cold engine or postpones intentional idle shutdown', async () => {
  const f = await fixture({ idleMs: 60 });
  for (let i = 0; i < 10; i++) assert.equal(await f.health.ready(), true);
  assert.equal(f.starts(), 0);
  assert.equal(f.pings(), 0);
  const docker = new InnerDockerHealth(true, {
    socketPath: f.publicSocket,
    cacheMs: 0,
  });
  assert.equal(await docker.ready(), true);
  assert.equal(f.starts(), 1);
  for (let i = 0; i < 20; i++) {
    assert.equal(await f.health.ready(), true);
    await delay(10);
  }
  assert.equal(f.stops(), 1);
  assert.equal(f.starts(), 1);
  assert.equal(await f.health.ready(), true);
  assert.equal(await docker.ready(), true);
  assert.equal(f.starts(), 2);
});

void test('a broken active engine fails health and can recover without activation by health', async () => {
  const f = await fixture();
  await f.proxy.ensureReady();
  assert.equal(await f.health.ready(), true);
  f.setPing((res) => res.writeHead(503).end('unavailable'));
  assert.equal(await f.health.ready(), false);
  f.setPing(() => {});
  assert.equal(await f.health.ready(), false);
  f.setPing((res) => res.end('OK'));
  assert.equal(await f.health.ready(), true);
  assert.equal(f.starts(), 1);
});

void test('startup failure and unexpected exit stay degraded until an actual Docker request recovers', async () => {
  const f = await fixture({ failFirst: true });
  const docker = new InnerDockerHealth(true, {
    socketPath: f.publicSocket,
    cacheMs: 0,
  });
  assert.equal(await docker.ready(), false);
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: false,
    dockerRecoveryRequired: true,
  });
  assert.equal(f.starts(), 1);
  assert.equal(await docker.ready(), true);
  assert.equal(await f.health.ready(), true);
  await f.crash();
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: false,
    dockerRecoveryRequired: true,
  });
  assert.equal(f.starts(), 2);
  assert.equal(await docker.ready(), true);
  assert.equal(await f.health.ready(), true);
  assert.equal(f.starts(), 3);
});

void test('a private ping closed by intentional shutdown does not report the idle supervisor broken', async () => {
  const permitStop = Promise.withResolvers<boolean>();
  const f = await fixture({ idleMs: 50, canStop: () => permitStop.promise });
  await f.proxy.ensureReady();
  const entered = Promise.withResolvers<void>();
  f.setPing(() => entered.resolve());
  const pending = f.health.ready();
  try {
    await entered.promise;
    permitStop.resolve(true);
    assert.equal(await pending, true);
    assert.equal(f.stops(), 1);
    assert.equal(f.starts(), 1);
  } finally {
    permitStop.resolve(true);
  }
});

void test('health connections are capped and shutdown closes incomplete requests', async () => {
  const f = await fixture();
  const sockets = Array.from({ length: 24 }, () => {
    const socket = createConnection(f.healthSocket);
    socket.on('error', () => {});
    return socket;
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
  });
  await until(() => sockets.filter((socket) => socket.destroyed).length >= 8);
  assert.equal(f.starts(), 0);
  await f.proxy.close();
  await until(() => sockets.every((socket) => socket.destroyed));
  assert.equal(await f.health.ready(), false);
});

void test('replacement engine probes cannot join an earlier engine pending request', async (context) => {
  const permitStop = Promise.withResolvers<boolean>();
  let stopChecks = 0;
  const f = await fixture({
    idleMs: 30,
    canStop: () =>
      ++stopChecks === 1 ? permitStop.promise : Promise.resolve(false),
  });
  const blocked = Promise.withResolvers<boolean>();
  const entered = Promise.withResolvers<void>();
  // oxlint-disable-next-line typescript/unbound-method -- The mock calls this original with its actual reader receiver below.
  const snapshot = InnerDockerHealth.prototype.snapshot;
  let delayed = false;
  context.mock.method(
    InnerDockerHealth.prototype,
    'snapshot',
    function (this: InnerDockerHealth) {
      const options: unknown = Reflect.get(this, 'options');
      if (
        !delayed &&
        options &&
        typeof options === 'object' &&
        'socketPath' in options &&
        options.socketPath === f.privateSocket
      ) {
        delayed = true;
        // Keep the actual reader's coalescing promise pending across retirement,
        // as a delayed socket completion can be after the engine is reaped.
        Reflect.set(this, 'probe', () => {
          entered.resolve();
          return blocked.promise.then((ready) => ({ ready }));
        });
      }
      return snapshot.call(this);
    },
  );
  await f.proxy.ensureReady();
  const oldRequest = f.health.ready();
  try {
    await entered.promise;
    permitStop.resolve(true);
    await until(() => f.stops() === 1);
    await f.proxy.ensureReady();
    assert.equal(f.starts(), 2);
    const freshReader = new InnerDockerHealth(true, {
      socketPath: f.healthSocket,
      cacheMs: 0,
      supervisor: true,
    });
    assert.equal(await freshReader.ready(), true);
    assert.equal(f.pings(), 1);
    blocked.resolve(false);
    assert.equal(await oldRequest, true);
  } finally {
    permitStop.resolve(true);
    blocked.resolve(false);
    await oldRequest;
  }
});

void test('a production-deadline ping stall refuses work without requiring recovery and then recovers', async () => {
  const f = await fixture({ healthCacheMs: 1_000 });
  await f.proxy.ensureReady();
  f.setPing(() => {});
  const started = performance.now();
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: false,
    dockerRecoveryRequired: false,
  });
  assert.ok(performance.now() - started >= 450);
  assert.equal(f.pings(), 1);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(await f.health.snapshot(), {
      dockerReady: false,
      dockerRecoveryRequired: false,
    });
  }
  assert.equal(f.pings(), 1);
  f.setPing((res) => res.end('OK'));
  await delay(1_050);
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: true,
    dockerRecoveryRequired: false,
  });
  assert.equal(f.starts(), 1);
  assert.equal(f.stops(), 0);
});

void test('sustained real probe failures require recovery, then healthy and replacement engines clear confidence', async () => {
  let healthNow = 0;
  const f = await fixture({ healthCacheMs: 1_000, healthNow: () => healthNow });
  await f.proxy.ensureReady();
  f.setPing(() => {});
  assert.equal((await f.health.snapshot()).dockerRecoveryRequired, false);
  await delay(4_550);
  healthNow = 1_000;
  assert.equal((await f.health.snapshot()).dockerRecoveryRequired, false);
  healthNow = 2_000;
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: false,
    dockerRecoveryRequired: true,
  });
  assert.equal(f.pings(), 3);
  // The same outer observer must not reuse confirmed failure during its cache
  // interval after a new engine replaces the one that supplied that proof.
  await f.crash();
  await f.proxy.ensureReady();
  assert.equal(f.starts(), 2);
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: false,
    dockerRecoveryRequired: false,
  });
  f.setPing((res) => res.end('OK'));
  healthNow = 3_000;
  assert.deepEqual(await f.health.snapshot(), {
    dockerReady: true,
    dockerRecoveryRequired: false,
  });
  f.setPing(() => {});
  healthNow = 4_000;
  assert.equal((await f.health.snapshot()).dockerRecoveryRequired, false);
});

void test('a stalled supervisor exceeds the production outer deadline once and a valid response resets transport evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tale-control-stall-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const socketPath = join(dir, 'health.sock');
  let available = false;
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    if (available) {
      res.setHeader('x-tale-docker-recovery-required', 'false');
      res.end('OK');
    }
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const health = new InnerDockerHealth(true, {
    socketPath,
    supervisor: true,
    cacheMs: 0,
  });
  const started = performance.now();
  const readings = await Promise.all([
    health.snapshot(),
    health.snapshot(),
    health.snapshot(),
  ]);
  assert.ok(performance.now() - started >= 700);
  assert.equal(calls, 1);
  for (const reading of readings) {
    assert.deepEqual(reading, {
      dockerReady: false,
      dockerRecoveryRequired: false,
    });
  }
  available = true;
  assert.deepEqual(await health.snapshot(), {
    dockerReady: true,
    dockerRecoveryRequired: false,
  });
});

void test('one health socket accepts only one request while its engine probe is pending', async () => {
  const f = await fixture();
  await f.proxy.ensureReady();
  const entered = Promise.withResolvers<ServerResponse>();
  f.setPing((res) => entered.resolve(res));
  const socket = createConnection(f.healthSocket);
  socket.on('error', () => {});
  cleanups.push(async () => {
    socket.destroy();
  });
  const closed = new Promise<void>((resolve) => socket.once('close', resolve));
  let result = '';
  socket.on('data', (chunk) => {
    result += chunk.toString();
  });
  socket.write('GET /_ping HTTP/1.1\r\nHost: local\r\n\r\n'.repeat(20));
  const response = await entered.promise;
  response.end('OK');
  await closed;
  assert.equal(f.pings(), 1);
  assert.equal(result.match(/HTTP\/1.1 200/g)?.length, 1);
});
