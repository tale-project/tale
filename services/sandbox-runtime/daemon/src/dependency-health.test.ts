import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dockerHealthy } from './dependency-health.ts';

describe('optional runtime dependency health', () => {
  test('probes Docker over its Unix socket and bounds a hung daemon', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runnerd-health-'));
    const socketPath = join(root, 'docker.sock');
    let stalled = false;
    const server = createServer((_req, res) => {
      if (!stalled) res.end('OK');
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      expect(await dockerHealthy(socketPath, 100)).toBe(true);
      stalled = true;
      const started = Date.now();
      expect(await dockerHealthy(socketPath, 50)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(await dockerHealthy(join(root, 'missing.sock'), 50)).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
