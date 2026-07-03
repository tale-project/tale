import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createConfigWatcher } from './config-watcher';

// Convex writes its executor socket (`…/.executor.sock`) under the config
// dir on self-hosted installs. fs.watch cannot open special files — without
// the socket guards in createConfigWatcher the resulting ENXIO escaped
// chokidar and crash-looped the platform on first boot. This test recreates
// that layout with a real unix socket: the watcher must survive it and still
// deliver events for ordinary config writes.
describe('createConfigWatcher — special files in the config dir', () => {
  let configDir: string;
  let socketServer: Server | undefined;
  let watcher: ReturnType<typeof createConfigWatcher> | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'config-watcher-test-'));
  });

  afterEach(async () => {
    await watcher?.close();
    await new Promise<void>((resolve) => {
      if (!socketServer) return resolve();
      socketServer.close(() => resolve());
    });
    rmSync(configDir, { recursive: true, force: true });
  });

  test('survives a unix socket and still emits for config writes', async () => {
    const socketDir = join(configDir, 'convex', 'tmp');
    mkdirSync(socketDir, { recursive: true });
    socketServer = createServer();
    await new Promise<void>((resolve, reject) => {
      socketServer?.once('error', reject);
      socketServer?.listen(join(socketDir, '.executor.sock'), resolve);
    });

    watcher = createConfigWatcher(configDir);
    const events: unknown[] = [];
    watcher.onChange((event) => {
      events.push(event);
    });

    // Give chokidar time to walk the tree (and hit the socket) before the
    // config write below — the pre-fix failure mode was a crash right here.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const agentDir = join(configDir, 'default', 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'helper.json'), '{}');

    await expect
      .poll(() => events.length, { timeout: 5000 })
      .toBeGreaterThan(0);
  });
});
