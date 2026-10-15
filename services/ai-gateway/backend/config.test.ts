import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';

const complete = () => ({
  AI_GATEWAY_API_KEY: 'api-key',
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
    expect(config.tokenMinHandoutSeconds).toBe(3600);
    expect(config.encryptionKey).toHaveLength(32);
  });

  it('turns the hand-out floor off at zero, and refuses a negative one', () => {
    expect(
      loadConfig({ ...complete(), AI_GATEWAY_TOKEN_MIN_HANDOUT_SECONDS: '0' })
        .config.tokenMinHandoutSeconds,
    ).toBe(0);
    expect(() =>
      loadConfig({
        ...complete(),
        AI_GATEWAY_TOKEN_MIN_HANDOUT_SECONDS: '-1',
      }),
    ).toThrow(ConfigError);
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
      { AI_GATEWAY_API_KEY: 'kept' },
      { generateMissingSecrets: true },
    );
    expect(config.apiKey).toBe('kept');
    expect(generated.map((secret) => secret.name)).toEqual([
      'AI_GATEWAY_ENCRYPTION_KEY',
    ]);
    expect(config.encryptionKey).toHaveLength(32);
  });

  it('never generates in the default (production) mode', () => {
    expect(() => loadConfig({ AI_GATEWAY_API_KEY: 'kept' })).toThrow(
      ConfigError,
    );
  });

  describe('the admin key', () => {
    it('is off unless it is set', () => {
      expect(loadConfig(complete()).config.adminApiKey).toBeNull();
    });

    it('is read when it is set', () => {
      expect(
        loadConfig({ ...complete(), AI_GATEWAY_ADMIN_API_KEY: 'admin-key' })
          .config.adminApiKey,
      ).toBe('admin-key');
    });

    // A pipeline that passes every secret it knows of hands an unset one
    // over as an empty string; that is "not configured", not a refusal to
    // boot — and not a key that an empty `Authorization` could match.
    it.each(['', '   '])('reads %j as not set', (blank) => {
      expect(
        loadConfig({ ...complete(), AI_GATEWAY_ADMIN_API_KEY: blank }).config
          .adminApiKey,
      ).toBeNull();
    });

    it('may be the same value as the API key, which makes it one key', () => {
      const { config } = loadConfig({
        ...complete(),
        AI_GATEWAY_ADMIN_API_KEY: 'api-key',
      });
      expect(config.adminApiKey).toBe(config.apiKey);
    });

    // Development generates what it must have to start. Turning on a way to
    // change the pool is not that, so it stays the developer's to ask for.
    it('is never generated for development', () => {
      const { config, generated } = loadConfig(
        {},
        { generateMissingSecrets: true },
      );
      expect(generated.map((secret) => secret.name)).toEqual([
        'AI_GATEWAY_API_KEY',
        'AI_GATEWAY_ENCRYPTION_KEY',
      ]);
      expect(config.adminApiKey).toBeNull();
    });
  });

  // The panel lost its login: a deployment that still sets the old secrets
  // must boot, not trip over an unknown key.
  it('ignores the retired panel-password and session secrets', () => {
    const { config } = loadConfig({
      ...complete(),
      AI_GATEWAY_PANEL_PASSWORD: 'no longer read',
      AI_GATEWAY_SESSION_SECRET: 'no longer read',
    });
    expect(config.apiKey).toBe('api-key');
  });
});
