import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../app.ts';
import {
  buildBlobServeUrl,
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

/**
 * The blob-serve builder must mint URLs that land on a route the 0.5 app
 * ACTUALLY MOUNTS. It used to mint the retired 0.4 `/http_api/storage` door
 * — mounted nowhere and forwarded by no proxy lane — so every stored email
 * attachment rendered as a dead link. These tests assert against the real
 * app router (createApp with stub deps), not a string constant: the minted
 * path must reach a mounted lane (the session gate answers, not Hono's
 * 404), and the retired path must stay unmounted.
 */

function stubApp() {
  const sql = () => Promise.resolve([]);
  const auth = {
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    api: { getSession: () => Promise.resolve(null) },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
  return createApp({ sql: sql as never, auth: auth as never });
}

describe('buildBlobServeUrl', () => {
  beforeEach(() => {
    process.env.SITE_URL = 'https://tale.example';
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.BASE_PATH;
  });

  it('mints a URL the app router actually mounts', async () => {
    const app = stubApp();
    const url = buildBlobServeUrl('s3:acme/blob-1', 'org_1', 'Report Q3.pdf');
    const { pathname, search, origin } = new URL(url);
    expect(origin).toBe('https://tale.example');

    const res = await app.request(`${pathname}${search}`);
    // The SESSION GATE answers (stubbed sessionless → 401): the path reached
    // the mounted files lane. Hono's own 404 would mean a dead link again.
    expect(res.status).toBe(401);
  });

  it('carries orgId, ref, and filename for the serve lane', () => {
    const url = new URL(
      buildBlobServeUrl('s3:acme/blob-1', 'org_1', 'Report Q3.pdf'),
    );
    expect(url.pathname).toBe('/api/app/files/serve');
    expect(url.searchParams.get('orgId')).toBe('org_1');
    expect(url.searchParams.get('ref')).toBe('s3:acme/blob-1');
    expect(url.searchParams.get('filename')).toBe('Report Q3.pdf');
  });

  it('honors BASE_PATH sub-path deployments', () => {
    process.env.BASE_PATH = '/tale';
    const url = buildBlobServeUrl('s3:acme/blob-1', 'org_1');
    expect(
      url.startsWith('https://tale.example/tale/api/app/files/serve?'),
    ).toBe(true);
    expect(new URL(url).searchParams.get('filename')).toBeNull();
  });

  it('the retired /http_api/storage door stays unmounted', async () => {
    const app = stubApp();
    const res = await app.request(
      '/http_api/storage?ref=s3:acme/blob-1&org=org_1',
    );
    expect(res.status).toBe(404);
  });
});
