import { describe, expect, it } from 'vitest';

import { makeWebdavCtx } from './ctx';

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
});
