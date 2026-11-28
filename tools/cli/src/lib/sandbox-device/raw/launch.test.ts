import { describe, expect, test } from 'bun:test';

import type { SandboxDeviceConfig } from '../config';
import { deviceVersion, rawSpawnerEnv, systemPath } from './launch';

const config = {
  version: 1,
  serverUrl: 'https://tale.example',
  deviceId: 'dev_1',
  deviceSecret: 'tsd_x',
  organizationId: 'org_1',
  name: 'mac',
  localToken: 'f'.repeat(64),
  stateDir: '/var/lib/tale-sandbox',
  maxSessions: 3,
  registry: 'ghcr.io/tale-project/tale',
  autoUpdate: false,
  relays: [],
  host: { os: 'linux', arch: 'x64', hostname: 'box' },
  runtime: 'raw',
  raw: {
    isolation: 'isolated',
    root: '/var/lib/tale-sandbox',
    slots: [{ user: 'tale-slot-01', uid: 61001, gid: 61001, home: '/h' }],
    madeSlots: true,
    path: ['/opt/tale-agents/bin', '/usr/bin'],
    binary: '/usr/local/lib/tale-sandbox/tale',
    service: 'systemd-system',
  },
} satisfies SandboxDeviceConfig;

describe('the raw device launcher', () => {
  test('hands the spawner the raw backend and its runtime', () => {
    const env = rawSpawnerEnv(
      config,
      '/var/lib/tale-sandbox/device.json',
      {
        dir: '/r',
        spawner: '/r/lib/sandbox-device.mjs',
        runnerd: '/r/lib/runnerd.mjs',
        bin: '/r/bin',
        claudeSettings: '/r/claude-settings.json',
      },
      { os: () => 'linux', execPath: () => '/usr/local/lib/tale-sandbox/tale' },
      '0.5.200',
    );
    expect(env).toMatchObject({
      SANDBOX_BACKEND: 'raw',
      SANDBOX_DEVICE_CONFIG: '/var/lib/tale-sandbox/device.json',
      SANDBOX_TOKEN: 'f'.repeat(64),
      SANDBOX_MAX_SESSIONS: '3',
      SANDBOX_PORT: '0',
      TALE_VERSION: '0.5.200',
    });
    const raw = JSON.parse(env.SANDBOX_RAW ?? '{}');
    expect(raw.runnerd).toEqual([
      '/usr/local/lib/tale-sandbox/tale',
      '/r/lib/runnerd.mjs',
    ]);
    expect(raw.runnerdEnv).toEqual({ BUN_BE_BUN: '1' });
    expect(raw.slots).toEqual(config.raw.slots);
    // The configured directories first, then the system's, each once.
    expect(raw.path).toEqual([
      '/opt/tale-agents/bin',
      '/usr/bin',
      ...systemPath('linux').filter((dir) => dir !== '/usr/bin'),
    ]);
  });

  test('a development build reports dev, which every hub takes', () => {
    expect(deviceVersion('1.0.0-dev')).toBe('dev');
    expect(deviceVersion('0.5.200')).toBe('0.5.200');
  });
});
