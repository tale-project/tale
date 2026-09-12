// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPresignedObject } from '../../lib/object-store.ts';
import { openFileContent } from './service.ts';

vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  locateOrgObjectStore: vi.fn(() => Promise.resolve({ backend: 's3' })),
  s3PresignGetUrl: vi.fn(() => Promise.resolve('https://store/acme/blob-1')),
  fetchPresignedObject: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));

/**
 * The content lane ships the store's `ETag` and `Last-Modified` and used to
 * ignore both on the way back in — a mirror that already held the bytes
 * re-downloaded every file on every sync. The client's preconditions now
 * travel to the store, which issued the validators, and its 304 comes back
 * as a bodiless answer.
 */
describe('openFileContent', () => {
  const sql = {} as Sql;
  const scope = { organizationId: 'org-1' };
  const fetched = vi.mocked(fetchPresignedObject);

  beforeEach(() => {
    fetched.mockReset();
  });

  it('forwards If-None-Match and If-Range with the Range, and drops If-Modified-Since beside If-None-Match', async () => {
    fetched.mockResolvedValue(
      new Response('bytes', { status: 200, headers: { etag: '"abc"' } }),
    );
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=0-9',
      conditions: {
        ifNoneMatch: '"abc"',
        ifModifiedSince: 'Thu, 10 Sep 2026 06:58:33 GMT',
        ifRange: 'W/"abc"',
      },
    });
    expect(fetched).toHaveBeenCalledWith(
      'https://store/acme/blob-1',
      expect.objectContaining({
        headers: {
          range: 'bytes=0-9',
          'if-none-match': '"abc"',
          'if-range': 'W/"abc"',
        },
      }),
    );
  });

  it('forwards If-Modified-Since alone, and If-Range only with a Range', async () => {
    fetched.mockResolvedValue(new Response(null, { status: 304 }));
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      conditions: {
        ifModifiedSince: 'Thu, 10 Sep 2026 06:58:33 GMT',
        ifRange: '"abc"',
      },
    });
    expect(fetched).toHaveBeenCalledWith(
      'https://store/acme/blob-1',
      expect.objectContaining({
        headers: { 'if-modified-since': 'Thu, 10 Sep 2026 06:58:33 GMT' },
      }),
    );
  });

  it('reduces a weak or edge-suffixed If-None-Match to the tags the store compares', async () => {
    fetched.mockResolvedValue(new Response(null, { status: 304 }));
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      conditions: { ifNoneMatch: 'W/"abc", "def-gzip" , W/"ghi-zstd"' },
    });
    expect(fetched).toHaveBeenCalledWith(
      'https://store/acme/blob-1',
      expect.objectContaining({
        headers: { 'if-none-match': '"abc", "def", "ghi"' },
      }),
    );
  });

  it('sends no request headers when the caller has none', async () => {
    fetched.mockResolvedValue(new Response('bytes', { status: 200 }));
    await openFileContent(sql, scope, 's3:acme/blob-1', { conditions: {} });
    const [, options] = fetched.mock.calls[0] ?? [];
    expect(options).not.toHaveProperty('headers');
  });

  it("hands the store's 304 on as a bodiless answer with its validators", async () => {
    fetched.mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: {
          etag: '"abc"',
          'last-modified': 'Thu, 10 Sep 2026 06:58:33 GMT',
        },
      }),
    );
    const served = await openFileContent(sql, scope, 's3:acme/blob-1', {
      conditions: { ifNoneMatch: '"abc"' },
    });
    expect(served).not.toBeNull();
    expect(served?.status).toBe(304);
    expect(served?.body).toBeNull();
    expect(served?.headers.get('etag')).toBe('"abc"');
    expect(served?.headers.get('last-modified')).toBe(
      'Thu, 10 Sep 2026 06:58:33 GMT',
    );
  });

  it('still streams a 200 when the precondition does not hold', async () => {
    fetched.mockResolvedValue(
      new Response('bytes', { status: 200, headers: { etag: '"def"' } }),
    );
    const served = await openFileContent(sql, scope, 's3:acme/blob-1', {
      conditions: { ifNoneMatch: '"abc"' },
    });
    expect(served?.status).toBe(200);
    expect(served?.body).not.toBeNull();
    expect(served?.headers.get('etag')).toBe('"def"');
  });
});
