// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceServerUrl, deviceTunnelUrl } from './settings.ts';

afterEach(() => vi.unstubAllEnvs());

describe('device addresses', () => {
  it('are the public site and its tunnel path', () => {
    vi.stubEnv('SITE_URL', 'https://tale.example.com/');
    vi.stubEnv('BASE_PATH', '');
    vi.stubEnv('SANDBOX_DEVICE_TUNNEL_URL', '');
    expect(deviceServerUrl()).toBe('https://tale.example.com');
    expect(deviceTunnelUrl()).toBe('wss://tale.example.com/sandbox/tunnel');
  });

  it('keep a deployment subpath: the proxy strips it before routing', () => {
    vi.stubEnv('SITE_URL', 'https://example.com');
    vi.stubEnv('BASE_PATH', '/tale/');
    vi.stubEnv('SANDBOX_DEVICE_TUNNEL_URL', '');
    expect(deviceServerUrl()).toBe('https://example.com/tale');
    expect(deviceTunnelUrl()).toBe('wss://example.com/tale/sandbox/tunnel');
  });

  it('take an override written as http(s) as the WebSocket it means', () => {
    vi.stubEnv('SITE_URL', 'https://tale.example.com');
    vi.stubEnv(
      'SANDBOX_DEVICE_TUNNEL_URL',
      'http://10.0.0.5:8004/sandbox/tunnel',
    );
    expect(deviceTunnelUrl()).toBe('ws://10.0.0.5:8004/sandbox/tunnel');
    vi.stubEnv(
      'SANDBOX_DEVICE_TUNNEL_URL',
      'wss://devices.example.com/sandbox/tunnel',
    );
    expect(deviceTunnelUrl()).toBe('wss://devices.example.com/sandbox/tunnel');
  });
});
