import { describe, expect, test } from 'bun:test';

import {
  DeviceConfigError,
  deviceImages,
  parseDeviceConfig,
} from './device-config.ts';

// The shape `tale sandbox connect` writes (tools/cli/src/lib/sandbox-device/
// config.ts pins the same literal from its side).
const WRITTEN_BY_THE_CLI = {
  version: 1,
  serverUrl: 'https://acme.tale.dev/',
  deviceId: '0f0e6f4e-1c53-4c1b-9c55-7c3c5f8d9a01',
  deviceSecret: 'tsd_0123456789abcdef',
  organizationId: 'org_acme',
  name: 'studio-mac',
  localToken: 'a'.repeat(64),
  stateDir: '/Users/alex/.tale/sandbox/',
  maxSessions: 4,
  registry: 'ghcr.io/tale-project/tale',
  autoUpdate: true,
  relays: [
    { name: 'api', url: 'http://backend-api:3005' },
    { name: 'gateway', url: 'http://sandbox-llm-gateway:8080' },
  ],
  host: { os: 'darwin', arch: 'arm64', hostname: 'studio-mac.local' },
};

describe('parseDeviceConfig', () => {
  test('reads what the CLI writes, normalizing trailing slashes', () => {
    const cfg = parseDeviceConfig(WRITTEN_BY_THE_CLI);
    expect(cfg.serverUrl).toBe('https://acme.tale.dev');
    expect(cfg.stateDir).toBe('/Users/alex/.tale/sandbox');
    expect(cfg.relays).toHaveLength(2);
    expect(cfg.images).toBeUndefined();
  });

  test('refuses a future version, a relative state dir and unknown relays', () => {
    expect(() =>
      parseDeviceConfig({ ...WRITTEN_BY_THE_CLI, version: 2 }),
    ).toThrow(/unsupported version/);
    expect(() =>
      parseDeviceConfig({ ...WRITTEN_BY_THE_CLI, stateDir: 'tale/sandbox' }),
    ).toThrow(/absolute/);
    expect(() =>
      parseDeviceConfig({
        ...WRITTEN_BY_THE_CLI,
        relays: [{ name: 'db', url: 'http://db:5432' }],
      }),
    ).toThrow(DeviceConfigError);
    expect(() =>
      parseDeviceConfig({ ...WRITTEN_BY_THE_CLI, maxSessions: 0 }),
    ).toThrow(/maxSessions/);
  });

  test('images follow the release unless pinned explicitly', () => {
    const cfg = parseDeviceConfig(WRITTEN_BY_THE_CLI);
    expect(deviceImages(cfg, '0.5.60')).toEqual({
      sandbox: 'ghcr.io/tale-project/tale/tale-sandbox:0.5.60',
      runtime: 'ghcr.io/tale-project/tale/tale-sandbox-runtime:0.5.60',
      egress: 'ghcr.io/tale-project/tale/tale-sandbox-egress:0.5.60',
    });
    const pinned = parseDeviceConfig({
      ...WRITTEN_BY_THE_CLI,
      images: { sandbox: 'tale-sandbox:local' },
    });
    expect(deviceImages(pinned, '0.5.60').sandbox).toBe('tale-sandbox:local');
    expect(deviceImages(pinned, '0.5.60').runtime).toBe(
      'ghcr.io/tale-project/tale/tale-sandbox-runtime:0.5.60',
    );
  });
});
