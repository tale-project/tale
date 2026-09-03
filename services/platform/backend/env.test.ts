import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.ts';

describe('loadEnv', () => {
  it('applies defaults for port, role, and concurrency', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://x' });
    expect(env.PORT).toBe(3005);
    expect(env.ROLE).toBe('all');
    expect(env.WORKER_CONCURRENCY).toBe(5);
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      PORT: '3999',
      ROLE: 'worker',
      WORKER_CONCURRENCY: '2',
    });
    expect(env.PORT).toBe(3999);
    expect(env.ROLE).toBe('worker');
    expect(env.WORKER_CONCURRENCY).toBe(2);
  });

  it('passes SENTRY_DSN through and leaves it optional', () => {
    expect(
      loadEnv({ DATABASE_URL: 'postgres://x' }).SENTRY_DSN,
    ).toBeUndefined();
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      SENTRY_DSN: 'https://key@sentry.example/1',
    });
    expect(env.SENTRY_DSN).toBe('https://key@sentry.example/1');
  });

  it('rejects a missing DATABASE_URL and an unknown role', () => {
    expect(() => loadEnv({})).toThrow();
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://x', ROLE: 'ui' }),
    ).toThrow();
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
      const source: NodeJS.ProcessEnv = {
        DATABASE_URL: 'postgres://x',
        INSTANCE_SECRET: secret,
      };
      loadEnv(source);
      // Byte-identical to docker-entrypoint.sh's web-lane derivation:
      //   printf '%s' "${INSTANCE_SECRET}:webdav-hmac:v1" | sha256sum
      expect(source.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(derived);
    });

    it('never overrides an explicitly set key (operator rotation)', () => {
      const explicit = 'f'.repeat(64);
      const source: NodeJS.ProcessEnv = {
        DATABASE_URL: 'postgres://x',
        INSTANCE_SECRET: secret,
        WEBDAV_APP_PASSWORD_HMAC_KEY: explicit,
      };
      loadEnv(source);
      expect(source.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(explicit);
    });

    it('leaves the key unset without INSTANCE_SECRET (minimal dev)', () => {
      const source: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://x' };
      loadEnv(source);
      expect(source.WEBDAV_APP_PASSWORD_HMAC_KEY).toBeUndefined();
    });
  });
});
