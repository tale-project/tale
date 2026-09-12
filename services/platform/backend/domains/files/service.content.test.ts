// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPresignedObject, s3HeadObject } from '../../lib/object-store.ts';
import { openFileContent } from './service.ts';

vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  locateOrgObjectStore: vi.fn(() => Promise.resolve({ backend: 's3' })),
  s3PresignGetUrl: vi.fn(() => Promise.resolve('https://store/acme/blob-1')),
  s3HeadObject: vi.fn(),
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
  const headed = vi.mocked(s3HeadObject);
  /** The object as the store's HEAD attests it: 1000 bytes, validators. */
  const blob = {
    size: 1000,
    contentType: 'text/plain',
    etag: '"abc"',
    lastModified: 'Thu, 10 Sep 2026 06:58:33 GMT',
  };

  beforeEach(() => {
    fetched.mockReset();
    headed.mockReset();
    headed.mockResolvedValue(blob);
  });

  it('forwards If-None-Match and If-Range with the Range, and drops If-Modified-Since beside If-None-Match', async () => {
    fetched.mockResolvedValue(
      new Response('bytes', { status: 206, headers: { etag: '"abc"' } }),
    );
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=0-9',
      conditions: {
        ifNoneMatch: '"abc"',
        ifModifiedSince: 'Thu, 10 Sep 2026 06:58:33 GMT',
        ifRange: '"abc"',
      },
    });
    expect(fetched).toHaveBeenCalledWith(
      'https://store/acme/blob-1',
      expect.objectContaining({
        headers: {
          range: 'bytes=0-9',
          'if-none-match': '"abc"',
          'if-range': '"abc"',
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

/**
 * D-01: a `Range` the file cannot satisfy used to be forwarded to the
 * store, whose 416 came back with the `Content-Type`/`Content-Length` of
 * its XML error document on a bodiless answer — the edge aborted the
 * stream and `curl -C -` on a complete download got no status line at
 * all. The range is now judged here, against the object's HEAD, and the
 * 416 is the lane's own: empty, sized, never the store's headers.
 */
describe('openFileContent — the Range judged before any byte is fetched', () => {
  const sql = {} as Sql;
  const scope = { organizationId: 'org-1' };
  const fetched = vi.mocked(fetchPresignedObject);
  const headed = vi.mocked(s3HeadObject);
  const blob = {
    size: 1000,
    contentType: 'text/plain',
    etag: '"abc"',
    lastModified: 'Thu, 10 Sep 2026 06:58:33 GMT',
  };

  beforeEach(() => {
    fetched.mockReset();
    headed.mockReset();
    headed.mockResolvedValue(blob);
  });

  it('answers a bodiless 416 naming the size for a range at or past the end, without a GET', async () => {
    for (const range of ['bytes=1000-', 'bytes=1000-1000', 'bytes=5000-']) {
      const served = await openFileContent(sql, scope, 's3:acme/blob-1', {
        range,
      });
      expect(served).toMatchObject({ status: 416, body: null });
      expect(served?.headers.get('content-range')).toBe('bytes */1000');
      expect(served?.headers.get('content-length')).toBe('0');
      expect(served?.headers.get('accept-ranges')).toBe('bytes');
      expect(served?.headers.get('etag')).toBe('"abc"');
      expect(served?.headers.get('last-modified')).toBe(blob.lastModified);
      expect(served?.headers.get('content-type')).toBeNull();
    }
    expect(fetched).not.toHaveBeenCalled();
  });

  it('forwards a satisfiable range normalised — a suffix resolved, the end clamped', async () => {
    fetched.mockResolvedValue(new Response('tail', { status: 206 }));
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=-100',
    });
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=0-99999999',
    });
    expect(fetched.mock.calls[0]?.[1]).toMatchObject({
      headers: { range: 'bytes=900-999' },
    });
    expect(fetched.mock.calls[1]?.[1]).toMatchObject({
      headers: { range: 'bytes=0-999' },
    });
  });

  it('ignores a Range it cannot read and serves the whole file', async () => {
    fetched.mockResolvedValue(new Response('whole', { status: 200 }));
    for (const range of ['bytes=abc', 'bytes=0-9,20-29', 'items=0-9']) {
      fetched.mockClear();
      const served = await openFileContent(sql, scope, 's3:acme/blob-1', {
        range,
      });
      expect(served?.status).toBe(200);
      const [, options] = fetched.mock.calls[0] ?? [];
      expect(options).not.toHaveProperty('headers');
    }
  });

  it('drops the range when If-Range names another representation, and keeps it when it matches', async () => {
    fetched.mockResolvedValue(new Response('whole', { status: 200 }));
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=0-9',
      conditions: { ifRange: '"stale"' },
    });
    const [, mismatch] = fetched.mock.calls[0] ?? [];
    expect(mismatch).not.toHaveProperty('headers');

    fetched.mockClear();
    fetched.mockResolvedValue(new Response('part', { status: 206 }));
    await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=0-9',
      conditions: { ifRange: 'Fri, 11 Sep 2026 00:00:00 GMT' },
    });
    expect(fetched.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        range: 'bytes=0-9',
        'if-range': 'Fri, 11 Sep 2026 00:00:00 GMT',
      },
    });
  });

  it("never forwards the store's own 416 — its XML body's headers are replaced by the lane's", async () => {
    fetched.mockResolvedValue(
      new Response('<Error>InvalidRange</Error>', {
        status: 416,
        headers: {
          'content-type': 'application/xml',
          'content-length': '27',
          'content-range': 'bytes */800',
        },
      }),
    );
    const served = await openFileContent(sql, scope, 's3:acme/blob-1', {
      range: 'bytes=900-999',
    });
    expect(served).toMatchObject({ status: 416, body: null });
    expect(served?.headers.get('content-range')).toBe('bytes */800');
    expect(served?.headers.get('content-length')).toBe('0');
    expect(served?.headers.get('content-type')).toBeNull();
  });

  it('answers a HEAD with the size, type and validators, ignoring a Range', async () => {
    const served = await openFileContent(sql, scope, 's3:acme/blob-1', {
      head: true,
      range: 'bytes=5000-',
    });
    expect(served).toMatchObject({ status: 200, body: null });
    expect(served?.headers.get('content-length')).toBe('1000');
    expect(served?.headers.get('content-type')).toBe('text/plain');
    expect(served?.headers.get('etag')).toBe('"abc"');
    expect(served?.headers.get('last-modified')).toBe(blob.lastModified);
    expect(served?.headers.get('accept-ranges')).toBe('bytes');
    expect(served?.headers.get('content-range')).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('answers null for a blob the HEAD no longer finds', async () => {
    headed.mockResolvedValue(null);
    expect(
      await openFileContent(sql, scope, 's3:acme/blob-1', {
        range: 'bytes=0-1',
      }),
    ).toBeNull();
    expect(
      await openFileContent(sql, scope, 's3:acme/blob-1', { head: true }),
    ).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });
});
