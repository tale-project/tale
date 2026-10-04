import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InnerDockerHealth } from './inner-docker-health.ts';

const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function engine(listener: RequestListener) {
  const root = await mkdtemp(join(tmpdir(), 'tale-docker-health-'));
  roots.push(root);
  const socketPath = join(root, 'docker.sock');
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { socketPath, server };
}

describe('inner Docker readiness', () => {
  test('disabled capabilities do not touch a Docker socket', async () => {
    expect(
      await new InnerDockerHealth(false, { socketPath: '/absent' }).ready(),
    ).toBe(true);
  });

  test('coalesces probes, caches briefly, and observes engine failure and recovery', async () => {
    let calls = 0;
    let available = true;
    let now = 0;
    const { socketPath } = await engine((_req, res) => {
      calls += 1;
      res.writeHead(available ? 200 : 503);
      res.end(available ? 'OK' : 'unavailable');
    });
    const health = new InnerDockerHealth(true, { socketPath, now: () => now });
    expect(
      await Promise.all([health.ready(), health.ready(), health.ready()]),
    ).toEqual([true, true, true]);
    expect(calls).toBe(1);
    available = false;
    expect(await health.ready()).toBe(true);
    now = 1_000;
    expect(await health.ready()).toBe(false);
    available = true;
    now = 2_000;
    expect(await health.ready()).toBe(true);
    expect(calls).toBe(3);
  });

  test('bounds a stalled response and closes its connection', async () => {
    let closed = false;
    const { socketPath } = await engine((_req, res) => {
      res.on('close', () => {
        closed = true;
      });
    });
    const health = new InnerDockerHealth(true, { socketPath, timeoutMs: 30 });
    const started = Date.now();
    expect(await health.ready()).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
    await Bun.sleep(10);
    expect(closed).toBe(true);
  });

  test.each(['not Docker', 'OK'.repeat(100)])(
    'refuses a malformed ping body: %s',
    async (body) => {
      const { socketPath } = await engine((_req, res) => res.end(body));
      expect(await new InnerDockerHealth(true, { socketPath }).ready()).toBe(
        false,
      );
    },
  );

  test('a missing engine reports unavailable without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tale-no-docker-'));
    roots.push(root);
    expect(
      await new InnerDockerHealth(true, {
        socketPath: join(root, 'missing.sock'),
      }).ready(),
    ).toBe(false);
  });

  test('recovery requires distinct failed probes over time and a healthy probe clears the streak', async () => {
    let calls = 0;
    let available = false;
    let now = 0;
    const { socketPath } = await engine((_req, res) => {
      calls++;
      res
        .writeHead(available ? 200 : 503)
        .end(available ? 'OK' : 'unavailable');
    });
    const health = new InnerDockerHealth(true, { socketPath, now: () => now });
    const unconfirmed = { dockerReady: false, dockerRecoveryRequired: false };
    expect(await health.snapshot()).toEqual(unconfirmed);
    for (let i = 0; i < 20; i++)
      expect(await health.snapshot()).toEqual(unconfirmed);
    expect(calls).toBe(1);
    now = 4_000;
    expect(await health.snapshot()).toEqual(unconfirmed);
    now = 5_000;
    expect(await health.snapshot()).toEqual({
      dockerReady: false,
      dockerRecoveryRequired: true,
    });
    expect(calls).toBe(3);
    now = 6_000;
    available = true;
    expect(await health.snapshot()).toEqual({
      dockerReady: true,
      dockerRecoveryRequired: false,
    });
    now = 7_000;
    available = false;
    expect(await health.snapshot()).toEqual(unconfirmed);
  });

  test('supervisor confidence is authoritative instead of recounting its cached failures', async () => {
    let now = 0;
    let confidence = 'false';
    const { socketPath } = await engine((_req, res) => {
      res.setHeader('x-tale-docker-recovery-required', confidence);
      res.writeHead(503).end('unavailable');
    });
    const health = new InnerDockerHealth(true, {
      socketPath,
      supervisor: true,
      cacheMs: 0,
      now: () => now,
    });
    for (let i = 0; i < 10; i++) {
      now += 5_000;
      expect(await health.snapshot()).toEqual({
        dockerReady: false,
        dockerRecoveryRequired: false,
      });
    }
    confidence = 'true';
    expect(await health.snapshot()).toEqual({
      dockerReady: false,
      dockerRecoveryRequired: true,
    });
    confidence = 'yes';
    expect(await health.snapshot()).toEqual({
      dockerReady: false,
      dockerRecoveryRequired: false,
    });
  });

  test('missing supervisor transport needs fresh failure evidence and a new observer starts empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tale-no-supervisor-'));
    roots.push(root);
    let now = 0;
    const options = {
      socketPath: join(root, 'missing.sock'),
      supervisor: true,
      now: () => now,
    };
    const health = new InnerDockerHealth(true, options);
    expect((await health.snapshot()).dockerRecoveryRequired).toBe(false);
    now = 4_000;
    expect((await health.snapshot()).dockerRecoveryRequired).toBe(false);
    now = 5_000;
    expect((await health.snapshot()).dockerRecoveryRequired).toBe(true);
    expect(
      (await new InnerDockerHealth(true, options).snapshot())
        .dockerRecoveryRequired,
    ).toBe(false);
  });

  test.each([undefined, 'true', 'yes', 'true, false'])(
    'missing or contradictory supervisor metadata cannot assert recovery: %s',
    async (header) => {
      const { socketPath } = await engine((_req, res) => {
        if (header !== undefined)
          res.setHeader('x-tale-docker-recovery-required', header);
        res.end('OK');
      });
      expect(
        await new InnerDockerHealth(true, {
          socketPath,
          supervisor: true,
        }).snapshot(),
      ).toEqual({
        dockerReady: false,
        dockerRecoveryRequired: false,
      });
    },
  );

  test('recovery permission is never reused from the supervisor cache after it becomes healthy', async () => {
    let available = false;
    let calls = 0;
    const { socketPath } = await engine((_req, res) => {
      calls++;
      res.setHeader(
        'x-tale-docker-recovery-required',
        available ? 'false' : 'true',
      );
      res
        .writeHead(available ? 200 : 503)
        .end(available ? 'OK' : 'unavailable');
    });
    const health = new InnerDockerHealth(true, {
      socketPath,
      supervisor: true,
      now: () => 0,
    });
    expect((await health.snapshot()).dockerRecoveryRequired).toBe(true);
    available = true;
    expect(await health.snapshot()).toEqual({
      dockerReady: true,
      dockerRecoveryRequired: false,
    });
    expect(calls).toBe(2);
  });
});
