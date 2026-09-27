import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildSandboxDeviceConfig,
  defaultMaxSessions,
  readSandboxDeviceConfig,
  sandboxDeviceConfigPath,
  writeSandboxDeviceConfig,
} from './config';

const JOINED = {
  deviceId: '0f0e6f4e-1c53-4c1b-9c55-7c3c5f8d9a01',
  deviceSecret: 'tsd_0123456789abcdef',
  organizationId: 'org_acme',
  name: 'studio-mac',
  serverUrl: 'https://acme.tale.dev',
  serverVersion: '0.5.60',
  tunnelUrl: 'wss://acme.tale.dev/sandbox/tunnel',
  relays: [
    { name: 'api' as const, url: 'http://backend-api:3005' },
    { name: 'gateway' as const, url: 'http://sandbox-llm-gateway:8080' },
  ],
  registry: 'ghcr.io/tale-project/tale',
};

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('sandbox device config', () => {
  test('carries every field the sandbox image reads', () => {
    const config = buildSandboxDeviceConfig(JOINED, {
      stateDir: '/Users/alex/.tale/sandbox',
      maxSessions: 4,
      host: { os: 'darwin', arch: 'arm64', hostname: 'studio-mac.local' },
      autoUpdate: true,
      cliServerUrl: 'https://acme.tale.dev/',
    });
    // The literal services/sandbox/src/devices/device-config.test.ts parses
    // (WRITTEN_BY_THE_CLI) — the two sides of one file format.
    expect({ ...config, localToken: 'a'.repeat(64) }).toEqual({
      version: 1,
      serverUrl: 'https://acme.tale.dev',
      deviceId: '0f0e6f4e-1c53-4c1b-9c55-7c3c5f8d9a01',
      deviceSecret: 'tsd_0123456789abcdef',
      organizationId: 'org_acme',
      name: 'studio-mac',
      localToken: 'a'.repeat(64),
      stateDir: '/Users/alex/.tale/sandbox',
      maxSessions: 4,
      registry: 'ghcr.io/tale-project/tale',
      autoUpdate: true,
      relays: [
        { name: 'api', url: 'http://backend-api:3005' },
        { name: 'gateway', url: 'http://sandbox-llm-gateway:8080' },
      ],
      host: { os: 'darwin', arch: 'arm64', hostname: 'studio-mac.local' },
    });
    // A fresh local signing secret per device.
    expect(config.localToken).toMatch(/^[0-9a-f]{64}$/);
  });

  test('records the shell URL only when the containers use another', () => {
    const config = buildSandboxDeviceConfig(JOINED, {
      stateDir: '/tmp/x',
      maxSessions: 1,
      host: { os: 'linux', arch: 'x64', hostname: 'box' },
      autoUpdate: false,
      cliServerUrl: 'http://localhost:3000',
      deviceServerUrl: 'http://host.docker.internal:3000',
    });
    expect(config.serverUrl).toBe('http://host.docker.internal:3000');
    expect(config.cliServerUrl).toBe('http://localhost:3000');
  });

  test('is written owner-only and reads back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tale-device-'));
    dirs.push(home);
    const stateDir = join(home, 'sandbox');
    const config = buildSandboxDeviceConfig(JOINED, {
      stateDir,
      maxSessions: 2,
      host: { os: 'linux', arch: 'x64', hostname: 'box' },
      autoUpdate: true,
      cliServerUrl: 'https://acme.tale.dev',
    });
    const path = sandboxDeviceConfigPath(stateDir);
    await writeSandboxDeviceConfig(config, path);
    // POSIX modes: Windows ignores them (and devices refuse Windows anyway).
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
    }
    expect(await readSandboxDeviceConfig(path)).toEqual(config);
    expect(JSON.parse(await readFile(path, 'utf8')).deviceSecret).toBe(
      'tsd_0123456789abcdef',
    );
    expect(
      await readSandboxDeviceConfig(join(home, 'missing.json')),
    ).toBeNull();
  });

  test.each([
    [8, 16 * 1024 ** 3, 4],
    [16, 8 * 1024 ** 3, 2],
    [2, 64 * 1024 ** 3, 1],
    [1, 1024 ** 3, 1],
    [64, 256 * 1024 ** 3, 16],
    [null, null, 1],
  ])('%p CPUs and %p bytes offer %p sandboxes', (cpus, memory, expected) => {
    expect(defaultMaxSessions(cpus, memory)).toBe(expected);
  });
});
