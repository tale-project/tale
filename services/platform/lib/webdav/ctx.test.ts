import { describe, expect, it } from 'vitest';

import { makeWebdavCtx, rewriteStorageOrigin } from './ctx';

// Regression guard for the port-wiring bug: the ConvexHttpClient must target
// the BACKEND origin (CONVEX_URL, :3210 self-hosted) because query/mutation
// calls POST to /api/*, which the :3211 HTTP-actions site proxy does not
// serve. Only the /storage blob proxy (storageBaseUrl) belongs on :3211.
describe('makeWebdavCtx', () => {
  it('builds the Convex client on the backend URL, not the derived site URL', () => {
    const ctx = makeWebdavCtx({
      convexUrl: 'http://convex:3210',
      adminKey: 'test-admin-key',
    });
    // oxlint-disable-next-line no-unsafe-type-assertion
    expect((ctx.convex as unknown as { url: string }).url).toBe(
      'http://convex:3210',
    );
  });

  it('derives the site (:3211) origin for storageBaseUrl', () => {
    const ctx = makeWebdavCtx({
      convexUrl: 'http://convex:3210',
      adminKey: 'test-admin-key',
    });
    expect(ctx.storageBaseUrl).toBe('http://convex:3211');
  });

  it('honors an explicit convexSiteUrl for storageBaseUrl without touching the client', () => {
    const ctx = makeWebdavCtx({
      convexUrl: 'http://convex:3210',
      convexSiteUrl: 'https://site.example.com',
      adminKey: 'test-admin-key',
    });
    // oxlint-disable-next-line no-unsafe-type-assertion
    expect((ctx.convex as unknown as { url: string }).url).toBe(
      'http://convex:3210',
    );
    expect(ctx.storageBaseUrl).toBe('https://site.example.com');
  });

  it('exposes the backend (:3210) origin as convexApiUrl, trailing slash stripped', () => {
    expect(
      makeWebdavCtx({ convexUrl: 'http://convex:3210', adminKey: 'k' })
        .convexApiUrl,
    ).toBe('http://convex:3210');
    expect(
      makeWebdavCtx({ convexUrl: 'http://convex:3210/', adminKey: 'k' })
        .convexApiUrl,
    ).toBe('http://convex:3210');
  });
});

// Regression guard for the compose-only "ConnectionRefused" bug: Convex's
// generateUploadUrl()/getUrl() return URLs carrying the backend's self-reported
// origin (127.0.0.1:3210), which is the platform container's own loopback in
// docker compose. PUT/GET re-home those onto the reachable backend service name.
describe('rewriteStorageOrigin', () => {
  it('re-homes a 127.0.0.1:3210 upload URL onto the backend service origin, preserving path + token', () => {
    expect(
      rewriteStorageOrigin(
        'http://127.0.0.1:3210/api/storage/upload?token=abc123',
        'http://convex:3210',
      ),
    ).toBe('http://convex:3210/api/storage/upload?token=abc123');
  });

  it('re-homes a getUrl() blob URL the same way', () => {
    expect(
      rewriteStorageOrigin(
        'http://127.0.0.1:3210/api/storage/0a1b2c3d-storage-id',
        'http://convex:3210',
      ),
    ).toBe('http://convex:3210/api/storage/0a1b2c3d-storage-id');
  });

  it('is a no-op when origins already match (the bun dev case)', () => {
    const url = 'http://127.0.0.1:3210/api/storage/upload?token=abc123';
    expect(rewriteStorageOrigin(url, 'http://127.0.0.1:3210')).toBe(url);
  });

  it('ignores the backend path/port-suffix, swapping only protocol+host', () => {
    expect(
      rewriteStorageOrigin(
        'http://127.0.0.1:3210/api/storage/upload',
        'https://convex.internal:9000',
      ),
    ).toBe('https://convex.internal:9000/api/storage/upload');
  });

  it('returns the input unchanged when it is not a parseable absolute URL', () => {
    expect(rewriteStorageOrigin('not a url', 'http://convex:3210')).toBe(
      'not a url',
    );
    expect(rewriteStorageOrigin('http://127.0.0.1:3210/x', 'not a url')).toBe(
      'http://127.0.0.1:3210/x',
    );
  });
});
