import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.ts';

const KEY_HEX = 'ab'.repeat(32);
const BASE = { DATABASE_URL: 'postgres://x', ENCRYPTION_SECRET_HEX: KEY_HEX };

describe('loadEnv', () => {
  it('validates and normalizes the authenticator client name', () => {
    expect(loadEnv(BASE).TOTP_CLIENT_NAME).toBeUndefined();
    expect(
      loadEnv({ ...BASE, TOTP_CLIENT_NAME: ' Example \t plus ' })
        .TOTP_CLIENT_NAME,
    ).toBe('Example plus');
    for (const value of ['', ' ', 'Example: Admin', 'a'.repeat(41)]) {
      expect(() => loadEnv({ ...BASE, TOTP_CLIENT_NAME: value })).toThrow();
    }
  });
  it('validates and normalizes the authenticator environment', () => {
    expect(loadEnv(BASE).TOTP_ENVIRONMENT).toBeUndefined();
    expect(
      loadEnv({ ...BASE, TOTP_ENVIRONMENT: ' te ' }).TOTP_ENVIRONMENT,
    ).toBe('TE');
    for (const value of [
      '',
      ' ',
      '<TE>',
      'te:issuer',
      'te/pr',
      'a'.repeat(33),
    ]) {
      expect(() => loadEnv({ ...BASE, TOTP_ENVIRONMENT: value })).toThrow();
    }
  });
  it('validates lightweight sessions and explicit Claude reasoning effort', () => {
    expect(loadEnv(BASE).SANDBOX_AGENT_PROFILE).toBe('agent');
    expect(loadEnv(BASE).TALE_SANDBOX_CLAUDE_EFFORT).toBeUndefined();
    expect(
      loadEnv({ ...BASE, TALE_SANDBOX_CLAUDE_EFFORT: '' })
        .TALE_SANDBOX_CLAUDE_EFFORT,
    ).toBeUndefined();
    expect(
      loadEnv({
        ...BASE,
        SANDBOX_AGENT_PROFILE: 'agent-light',
        TALE_SANDBOX_CLAUDE_EFFORT: 'medium',
      }),
    ).toMatchObject({
      SANDBOX_AGENT_PROFILE: 'agent-light',
      TALE_SANDBOX_CLAUDE_EFFORT: 'medium',
    });
    expect(() => loadEnv({ ...BASE, SANDBOX_AGENT_PROFILE: 'agnt' })).toThrow();
    expect(() =>
      loadEnv({ ...BASE, TALE_SANDBOX_CLAUDE_EFFORT: 'faster' }),
    ).toThrow();
  });

  it('bounds the shutdown drain, and leaves it to the role when unset', () => {
    expect(loadEnv(BASE).SHUTDOWN_DRAIN_MS).toBeUndefined();
    expect(
      loadEnv({ ...BASE, SHUTDOWN_DRAIN_MS: '45000' }).SHUTDOWN_DRAIN_MS,
    ).toBe(45_000);
    for (const value of ['999', '600001', '1.5', 'soon']) {
      expect(() => loadEnv({ ...BASE, SHUTDOWN_DRAIN_MS: value })).toThrow();
    }
  });

  it('applies defaults for port, role, and concurrency', () => {
    const env = loadEnv({ ...BASE });
    expect(env.PORT).toBe(3005);
    expect(env.ROLE).toBe('all');
    expect(env.WORKER_CONCURRENCY).toBe(5);
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({
      ...BASE,
      PORT: '3999',
      ROLE: 'worker',
      WORKER_CONCURRENCY: '2',
    });
    expect(env.PORT).toBe(3999);
    expect(env.ROLE).toBe('worker');
    expect(env.WORKER_CONCURRENCY).toBe(2);
  });

  it('reads the agent turn slots, unset by default and bounded', () => {
    expect(loadEnv({ ...BASE }).AGENT_START_SLOTS).toBeUndefined();
    expect(loadEnv({ ...BASE }).AGENT_DRIVE_SLOTS).toBeUndefined();
    const env = loadEnv({
      ...BASE,
      AGENT_START_SLOTS: '12',
      AGENT_DRIVE_SLOTS: '64',
    });
    expect(env.AGENT_START_SLOTS).toBe(12);
    expect(env.AGENT_DRIVE_SLOTS).toBe(64);
    expect(() => loadEnv({ ...BASE, AGENT_DRIVE_SLOTS: '0' })).toThrow();
    expect(() => loadEnv({ ...BASE, AGENT_START_SLOTS: 'lots' })).toThrow();
  });

  it('passes SENTRY_DSN through and leaves it optional', () => {
    expect(loadEnv({ ...BASE }).SENTRY_DSN).toBeUndefined();
    const env = loadEnv({
      ...BASE,
      SENTRY_DSN: 'https://key@sentry.example/1',
    });
    expect(env.SENTRY_DSN).toBe('https://key@sentry.example/1');
  });

  it('defaults backend tracing off and validates its independent sample rate', () => {
    expect(
      loadEnv({ ...BASE, SENTRY_TRACES_SAMPLE_RATE: '1' })
        .BACKEND_SENTRY_TRACES_SAMPLE_RATE,
    ).toBe(0);
    expect(
      loadEnv({ ...BASE, BACKEND_SENTRY_TRACES_SAMPLE_RATE: '0.1' })
        .BACKEND_SENTRY_TRACES_SAMPLE_RATE,
    ).toBe(0.1);
    for (const bad of ['-1', '1.01', 'NaN', 'Infinity', 'all']) {
      expect(() =>
        loadEnv({ ...BASE, BACKEND_SENTRY_TRACES_SAMPLE_RATE: bad }),
      ).toThrow();
    }
  });

  it('rejects a missing DATABASE_URL and an unknown role', () => {
    expect(() => loadEnv({ ENCRYPTION_SECRET_HEX: KEY_HEX })).toThrow();
    expect(() => loadEnv({ ...BASE, ROLE: 'ui' })).toThrow();
  });

  /**
   * The field-encryption root is read by two lanes (JWE + secret box) in
   * every role; a deployment without it used to boot and then fail every
   * credential save at runtime, naming a variable the docs called optional.
   */
  describe('ENCRYPTION_SECRET_HEX', () => {
    it('accepts 64 hex chars in either case', () => {
      expect(loadEnv({ ...BASE }).ENCRYPTION_SECRET_HEX).toBe(KEY_HEX);
      expect(() =>
        loadEnv({ ...BASE, ENCRYPTION_SECRET_HEX: KEY_HEX.toUpperCase() }),
      ).not.toThrow();
    });

    it('refuses boot when it is missing, empty, non-hex or not 32 bytes', () => {
      expect(() => loadEnv({ DATABASE_URL: 'postgres://x' })).toThrow(
        /ENCRYPTION_SECRET_HEX/,
      );
      for (const bad of [
        '',
        'not-hex-at-all',
        'ab'.repeat(16),
        'ab'.repeat(33),
      ]) {
        expect(() => loadEnv({ ...BASE, ENCRYPTION_SECRET_HEX: bad })).toThrow(
          /ENCRYPTION_SECRET_HEX must be 32 bytes as 64 hex chars/,
        );
      }
    });
  });

  /**
   * The container entrypoint's api/worker branch execs node BEFORE the web
   * lane's shell derivation runs, so the backend must derive the WebDAV
   * app-password HMAC key itself at boot — otherwise split-role deployments
   * silently lose WebDAV, app-password minting, hostcall signing, and
   * sandbox stage tokens, while the docs promise automatic derivation.
   */
  describe('WebDAV HMAC key derivation', () => {
    const secret = 'a'.repeat(64);
    const derived = createHash('sha256')
      .update(`${secret}:webdav-hmac:v1`)
      .digest('hex');

    it('derives the key from INSTANCE_SECRET onto the boot env', () => {
      const source: NodeJS.ProcessEnv = { ...BASE, INSTANCE_SECRET: secret };
      loadEnv(source);
      // Byte-identical to docker-entrypoint.sh's web-lane derivation:
      //   printf '%s' "${INSTANCE_SECRET}:webdav-hmac:v1" | sha256sum
      expect(source.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(derived);
    });

    it('never overrides an explicitly set key (operator rotation)', () => {
      const explicit = 'f'.repeat(64);
      const source: NodeJS.ProcessEnv = {
        ...BASE,
        INSTANCE_SECRET: secret,
        WEBDAV_APP_PASSWORD_HMAC_KEY: explicit,
      };
      loadEnv(source);
      expect(source.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(explicit);
    });

    it('leaves the key unset without INSTANCE_SECRET (minimal dev)', () => {
      const source: NodeJS.ProcessEnv = { ...BASE };
      loadEnv(source);
      expect(source.WEBDAV_APP_PASSWORD_HMAC_KEY).toBeUndefined();
    });
  });
});
