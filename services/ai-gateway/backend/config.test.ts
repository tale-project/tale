import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

const complete = () => ({
  AI_GATEWAY_API_KEY: 'api-key',
  AI_GATEWAY_PANEL_PASSWORD: 'panel-password',
  AI_GATEWAY_SESSION_SECRET: 'session-secret',
  AI_GATEWAY_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const { config, generated } = loadConfig(complete());
    expect(generated).toEqual([]);
    expect(config.dataDir).toBe('.data');
    expect(config.refreshIntervalSeconds).toBe(300);
    expect(config.usageMinIntervalSeconds).toBe(180);
    expect(config.tokenRefreshSkewSeconds).toBe(300);
    expect(config.encryptionKey).toHaveLength(32);
  });

  it('names every missing secret at once', () => {
    let thrown: unknown;
    try {
      loadConfig({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    if (!(thrown instanceof ConfigError))
      throw new Error('expected a ConfigError');
    expect(thrown.missing).toEqual([
      'AI_GATEWAY_API_KEY',
      'AI_GATEWAY_ENCRYPTION_KEY',
      'AI_GATEWAY_PANEL_PASSWORD',
      'AI_GATEWAY_SESSION_SECRET',
    ]);
  });

  it('refuses an encryption key that is not 32 bytes', () => {
    expect(() =>
      loadConfig({
        ...complete(),
        AI_GATEWAY_ENCRYPTION_KEY: randomBytes(16).toString('base64'),
      }),
    ).toThrow(ConfigError);
  });

  it('refuses a refresh interval that is not a positive integer', () => {
    expect(() =>
      loadConfig({ ...complete(), AI_GATEWAY_REFRESH_INTERVAL_SECONDS: '0' }),
    ).toThrow(ConfigError);
  });

  it('generates only the secrets the environment did not supply', () => {
    const { config, generated } = loadConfig(
      { AI_GATEWAY_PANEL_PASSWORD: 'kept' },
      { generateMissingSecrets: true },
    );
    expect(config.panelPassword).toBe('kept');
    expect(generated.map((secret) => secret.name)).toEqual([
      'AI_GATEWAY_API_KEY',
      'AI_GATEWAY_SESSION_SECRET',
      'AI_GATEWAY_ENCRYPTION_KEY',
    ]);
    expect(config.encryptionKey).toHaveLength(32);
  });

  it('never generates in the default (production) mode', () => {
    expect(() => loadConfig({ AI_GATEWAY_PANEL_PASSWORD: 'kept' })).toThrow(
      ConfigError,
    );
  });
});
