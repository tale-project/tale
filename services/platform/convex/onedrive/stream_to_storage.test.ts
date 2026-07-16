import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';

// The org resolver + blob seam are mocked so the test asserts the STREAMING
// decision (which backend + streamed vs buffered) without a real bucket.
const { orgSlugMock, resolveStoreMock, genUploadMock, putBlobMock } =
  vi.hoisted(() => ({
    orgSlugMock: vi.fn(),
    resolveStoreMock: vi.fn(),
    genUploadMock: vi.fn(),
    putBlobMock: vi.fn(),
  }));

vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: orgSlugMock,
}));
vi.mock('../lib/storage/object_store', () => ({
  resolveOrgObjectStore: resolveStoreMock,
}));
vi.mock('../lib/storage/blob_access', () => ({
  generateBlobUpload: genUploadMock,
  putBlob: putBlobMock,
}));

const { streamItemToStorage } = await import('./stream_to_storage');

function makeCtx() {
  const generateUploadUrl = vi
    .fn()
    .mockResolvedValue('https://upload.convex.test/post');
  const ctx = { storage: { generateUploadUrl } } as unknown as ActionCtx;
  return { ctx, generateUploadUrl };
}

/** Install a global `fetch` mock that resolves `responses` in order. Returns
 *  the mock so calls can be inspected. Carries `preconnect` so the assignment
 *  satisfies the `typeof fetch` type. */
function installFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  globalThis.fetch = Object.assign(fn, { preconnect: vi.fn() });
  return fn;
}

/** A download Response that reports a Content-Length header. */
function sizedDownload(data: number[], contentType: string): Response {
  const bytes = new Uint8Array(data);
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
    },
  });
}

/** A download Response with NO Content-Length (chunked/streamed source). */
function unsizedDownload(data: number[], contentType: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(data));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

const ARGS = { itemId: 'item1', token: 'tok', organizationId: 'org_1' };

describe('streamItemToStorage — per-org blob routing (#2737)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('convex-backed org: pipes the download into a generateUploadUrl POST', async () => {
    orgSlugMock.mockResolvedValue('acme');
    resolveStoreMock.mockResolvedValue({ backend: 'convex' });
    const fetchMock = installFetch(
      sizedDownload([1, 2, 3], 'application/pdf'),
      new Response(JSON.stringify({ storageId: 'convex_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { ctx, generateUploadUrl } = makeCtx();

    const res = await streamItemToStorage(ctx, ARGS);

    expect(generateUploadUrl).toHaveBeenCalledTimes(1);
    expect(putBlobMock).not.toHaveBeenCalled();
    expect(genUploadMock).not.toHaveBeenCalled();
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    expect(res.success).toBe(true);
    expect(res.storageId).toBe('convex_1');
  });

  it('S3 org with Content-Length: streams straight into the presigned PUT', async () => {
    orgSlugMock.mockResolvedValue('acme');
    resolveStoreMock.mockResolvedValue({ backend: 's3' });
    genUploadMock.mockResolvedValue({
      url: 'https://s3.acme.test/presigned-put',
      method: 'PUT',
      s3Ref: 's3:acme/uuid-1',
    });
    const fetchMock = installFetch(
      sizedDownload([1, 2, 3], 'application/pdf'),
      new Response(null, { status: 200 }),
    );
    const { ctx, generateUploadUrl } = makeCtx();

    const res = await streamItemToStorage(ctx, ARGS);

    // Never buffers, never touches Convex `_storage`.
    expect(putBlobMock).not.toHaveBeenCalled();
    expect(generateUploadUrl).not.toHaveBeenCalled();
    expect(genUploadMock).toHaveBeenCalledWith(ctx, 'acme', {
      contentType: 'application/pdf',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://s3.acme.test/presigned-put',
    );
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('PUT');
    expect(res.storageId).toBe('s3:acme/uuid-1');
    expect(res.size).toBe(3);
  });

  it('S3 org WITHOUT Content-Length: buffers then putBlob', async () => {
    orgSlugMock.mockResolvedValue('acme');
    resolveStoreMock.mockResolvedValue({ backend: 's3' });
    putBlobMock.mockResolvedValue('s3:acme/uuid-2');
    installFetch(unsizedDownload([9, 9, 9, 9], 'application/pdf'));
    const { ctx } = makeCtx();

    const res = await streamItemToStorage(ctx, ARGS);

    expect(genUploadMock).not.toHaveBeenCalled();
    expect(putBlobMock).toHaveBeenCalledWith(
      ctx,
      'acme',
      expect.any(Uint8Array),
      'application/pdf',
    );
    expect(res.storageId).toBe('s3:acme/uuid-2');
    expect(res.size).toBe(4);
  });

  it('unresolvable org: falls back to Convex _storage (never fails the import)', async () => {
    orgSlugMock.mockResolvedValue(null);
    installFetch(
      sizedDownload([1], 'application/pdf'),
      new Response(JSON.stringify({ storageId: 'convex_fallback' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { ctx, generateUploadUrl } = makeCtx();

    const res = await streamItemToStorage(ctx, ARGS);

    expect(resolveStoreMock).not.toHaveBeenCalled();
    expect(generateUploadUrl).toHaveBeenCalledTimes(1);
    expect(putBlobMock).not.toHaveBeenCalled();
    expect(res.storageId).toBe('convex_fallback');
  });
});
