import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SANDBOX_CONVEX_HTTP_API_BASE_DEFAULT,
  SANDBOX_CONVEX_STORAGE_BASE_DEFAULT,
  toSandboxStorageUrl,
} from './public_storage_url';

// The session container sits on the `--internal` sandbox net and its undici
// fetch ignores the egress proxy, so the ONLY convex origin it can reach is the
// `convex` alias (dual-homed container in docker/prod; socat relay in bun dev).
// A public SITE_URL / host.docker.internal / 127.0.0.1 / RFC1918 default would
// silently break storage staging in prod — the exact bug this contract guards.
// If you change these, they MUST stay `http://convex:<port>`.
describe('sandbox→convex reachability contract', () => {
  it('defaults to the in-sandbox `convex` alias, never a public/host origin', () => {
    expect(SANDBOX_CONVEX_STORAGE_BASE_DEFAULT).toBe('http://convex:3210');
    expect(SANDBOX_CONVEX_HTTP_API_BASE_DEFAULT).toBe('http://convex:3211');
    for (const base of [
      SANDBOX_CONVEX_STORAGE_BASE_DEFAULT,
      SANDBOX_CONVEX_HTTP_API_BASE_DEFAULT,
    ]) {
      expect(base).toMatch(/^http:\/\/convex:\d+$/);
      // Never an origin that is unreachable from the --internal sandbox net.
      expect(base).not.toMatch(
        /host\.docker\.internal|127\.0\.0\.1|localhost|192\.168\.|\b10\.|172\.(1[6-9]|2\d|3[01])\./i,
      );
    }
  });

  describe('toSandboxStorageUrl', () => {
    const KEY = 'SANDBOX_STORAGE_INTERNAL_BASE_URL';
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env[KEY];
      delete process.env[KEY];
    });
    afterEach(() => {
      if (saved === undefined) delete process.env[KEY];
      else process.env[KEY] = saved;
    });

    it('rewrites an internal storage URL onto the convex alias (env unset)', () => {
      expect(
        toSandboxStorageUrl('http://127.0.0.1:3210/api/storage/abc?token=xyz'),
      ).toBe('http://convex:3210/api/storage/abc?token=xyz');
    });

    it('does NOT fall back to a public URL when the env is unset', () => {
      // Regression: the old fallback was toPublicUrl(SITE_URL), unreachable from
      // the sandbox net. The origin must be the convex alias regardless of SITE_URL.
      const prevSite = process.env.SITE_URL;
      process.env.SITE_URL = 'https://demo.tale.dev';
      try {
        expect(
          toSandboxStorageUrl('http://127.0.0.1:3210/api/storage/abc'),
        ).toBe('http://convex:3210/api/storage/abc');
      } finally {
        if (prevSite === undefined) delete process.env.SITE_URL;
        else process.env.SITE_URL = prevSite;
      }
    });

    it('honors an explicit override', () => {
      process.env[KEY] = 'http://my-proxy:9000';
      expect(toSandboxStorageUrl('http://127.0.0.1:3210/api/storage/abc')).toBe(
        'http://my-proxy:9000/api/storage/abc',
      );
    });

    it('is idempotent (an already-rewritten URL passes through)', () => {
      expect(toSandboxStorageUrl('http://convex:3210/api/storage/abc')).toBe(
        'http://convex:3210/api/storage/abc',
      );
    });
  });
});
