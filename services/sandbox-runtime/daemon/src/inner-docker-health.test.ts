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
});
