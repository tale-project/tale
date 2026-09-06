// GET conditional-request + Range WIRING coverage (F63). stream-helpers.test.ts
// unit-tests the pure helpers (parseRangeHeader / ifNoneMatchMatches /
// ifRangeMatches / computeETag) in isolation; these tests exercise how
// handleGet ASSEMBLES them — the If-None-Match-over-If-Modified-Since
// precedence, the 304 short-circuit, the 416 with Content-Range, the
// If-Range→drop-range invalidation, the 206 upstream mirroring, and HEAD's
// empty body. The blob-streaming paths fetch upstream, so the cases that
// reach the fetch stub global `fetch`; the early-return cases need no stub.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatch } from './handler';
import { makeRequest, makeStubCtx, setupHmacEnv } from './test-helpers';

setupHmacEnv();

const ETAG_HASH = 'deadbeef';
const SIZE = 100;
// Fixed past mtime (ms) so the ETag / Last-Modified are deterministic.
const MTIME = 1_700_000_000_000;

function getCtx() {
  return makeStubCtx({
    queries: {
      'webdav/tree_queries:resolvePath': () => ({
        exists: true,
        kind: 'document' as const,
        documentId: 'doc1',
      }),
      'webdav/tree_queries:getDocumentProps': () => ({
        fileId: 'storage_1',
        size: SIZE,
        contentHash: ETAG_HASH, // → strong ETag `"deadbeef"`
        contentType: 'text/plain',
        title: 'file.txt',
        sourceModifiedAt: MTIME,
      }),
      'webdav/tree_queries:getWebdavBlobUrl': () =>
        'http://127.0.0.1:3210/api/storage/storage_1',
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET conditional + Range wiring (F63)', () => {
  it('If-None-Match matching the ETag → 304 with no body', async () => {
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        headers: { 'If-None-Match': `"${ETAG_HASH}"` },
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
  });

  it('If-Modified-Since at/after the mtime → 304', async () => {
    const since = new Date(MTIME + 5000).toUTCString();
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        headers: { 'If-Modified-Since': since },
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(304);
  });

  it('If-None-Match takes precedence over If-Modified-Since (non-matching ETag → not 304)', async () => {
    // Even though If-Modified-Since would 304, a present-but-non-matching
    // If-None-Match wins and the body is served.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('full', { status: 200 })),
    );
    const since = new Date(MTIME + 5000).toUTCString();
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        headers: { 'If-None-Match': '"other"', 'If-Modified-Since': since },
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(200);
  });

  it('a gone blob (getWebdavBlobUrl → null) → 404 with no upstream fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('never', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = makeStubCtx({
      queries: {
        'webdav/tree_queries:resolvePath': () => ({
          exists: true,
          kind: 'document' as const,
          documentId: 'doc1',
        }),
        'webdav/tree_queries:getDocumentProps': () => ({
          fileId: 'storage_1',
          size: SIZE,
          contentHash: ETAG_HASH,
          contentType: 'text/plain',
          title: 'file.txt',
          sourceModifiedAt: MTIME,
        }),
        'webdav/tree_queries:getWebdavBlobUrl': () => null,
      },
    });
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        authenticated: true,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HEAD → 200 with no body', async () => {
    const res = await dispatch(
      makeRequest({
        method: 'HEAD',
        pathname: '/dav/myorg/documents/file.txt',
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('an unsatisfiable Range → 416 with Content-Range', async () => {
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        headers: { Range: `bytes=${SIZE + 10}-${SIZE + 20}` },
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(416);
    expect(res.headers?.['Content-Range']).toBe(`bytes */${SIZE}`);
  });

  it('a satisfiable Range → 206 mirroring upstream Content-Range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('0123456789', {
            status: 206,
            headers: {
              'content-range': `bytes 0-9/${SIZE}`,
              'content-length': '10',
            },
          }),
      ),
    );
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        headers: { Range: 'bytes=0-9' },
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(206);
    expect(res.headers?.['Content-Range']).toBe(`bytes 0-9/${SIZE}`);
  });

  it('If-Range with a stale validator drops the Range → full 200 (no upstream Range)', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { headers?: Record<string, string> }) =>
        new Response('full', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await dispatch(
      makeRequest({
        method: 'GET',
        pathname: '/dav/myorg/documents/file.txt',
        headers: { Range: 'bytes=0-9', 'If-Range': '"stale-etag"' },
        authenticated: true,
      }),
      getCtx(),
    );
    expect(res.status).toBe(200);
    // The upstream fetch must not carry a Range header once If-Range fails.
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers?.Range).toBeUndefined();
  });
});
