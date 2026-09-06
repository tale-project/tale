import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.ts';

const KEY_HEX = 'ab'.repeat(32);
const BASE = { DATABASE_URL: 'postgres://x', ENCRYPTION_SECRET_HEX: KEY_HEX };

describe('loadEnv', () => {
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

  it('passes SENTRY_DSN through and leaves it optional', () => {
    expect(loadEnv({ ...BASE }).SENTRY_DSN).toBeUndefined();
    const env = loadEnv({
      ...BASE,
      SENTRY_DSN: 'https://key@sentry.example/1',
    });
    expect(env.SENTRY_DSN).toBe('https://key@sentry.example/1');
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
