import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';

// The per-org blob seam + org resolver are mocked so the test asserts the
// PROVIDER's routing decision (which backend it picks) without a real bucket.
const { putBlobMock, getBlobUrlMock, orgSlugMock } = vi.hoisted(() => ({
  putBlobMock: vi.fn(),
  getBlobUrlMock: vi.fn(),
  orgSlugMock: vi.fn(),
}));

vi.mock('../../../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: orgSlugMock,
}));
vi.mock('../../../lib/storage/blob_access', () => ({
  putBlob: putBlobMock,
  getBlobUrl: getBlobUrlMock,
}));

const { createConvexStorageProvider } =
  await import('./create_convex_storage_provider');

function makeCtx() {
  const store = vi.fn().mockResolvedValue('convex_blob_1');
  const getUrl = vi.fn().mockResolvedValue('http://convex.internal/blob_1');
  const runMutation = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    storage: { store, getUrl },
    runMutation,
  } as unknown as ActionCtx;
  return { ctx, store, getUrl, runMutation };
}

describe('createConvexStorageProvider — per-org blob routing (#2737)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('store(): routes to the org bucket via putBlob when the org resolves to S3', async () => {
    orgSlugMock.mockResolvedValue('acme');
    putBlobMock.mockResolvedValue('s3:acme/uuid-1');
    getBlobUrlMock.mockResolvedValue('https://s3.acme.test/presigned');
    const { ctx, store, runMutation } = makeCtx();

    const provider = createConvexStorageProvider(ctx, 'org_acme');
    const res = await provider.store({
      data: 'hello world',
      encoding: 'utf-8',
      contentType: 'text/plain',
      fileName: 'a.txt',
    });

    // Bytes go to the org's bucket, NOT Convex `_storage`.
    expect(putBlobMock).toHaveBeenCalledWith(
      ctx,
      'acme',
      expect.any(Uint8Array),
      'text/plain',
    );
    expect(store).not.toHaveBeenCalled();
    // The row records the s3 ref; the URL is the presigned S3 GET.
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storageId: 's3:acme/uuid-1', source: 'agent' }),
    );
    expect(res.fileId).toBe('s3:acme/uuid-1');
    expect(res.url).toBe('https://s3.acme.test/presigned');
    expect(res.size).toBe(new TextEncoder().encode('hello world').byteLength);
  });

  it('store(): falls back to Convex _storage when the org is unresolvable', async () => {
    orgSlugMock.mockResolvedValue(null);
    const { ctx, store } = makeCtx();

    const provider = createConvexStorageProvider(ctx, 'org_ghost');
    const res = await provider.store({
      data: 'x',
      encoding: 'utf-8',
      contentType: 'text/plain',
      fileName: 'x.txt',
    });

    expect(store).toHaveBeenCalledTimes(1);
    expect(putBlobMock).not.toHaveBeenCalled();
    expect(res.fileId).toBe('convex_blob_1');
  });

  it('download(): streams the fetched bytes into the org bucket for an S3 org', async () => {
    orgSlugMock.mockResolvedValue('acme');
    putBlobMock.mockResolvedValue('s3:acme/uuid-2');
    getBlobUrlMock.mockResolvedValue('https://s3.acme.test/presigned2');
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
      { preconnect: vi.fn() },
    );
    const { ctx, store } = makeCtx();

    const provider = createConvexStorageProvider(ctx, 'org_acme');
    const res = await provider.download({
      url: 'https://drive.example.com/file/1',
      headers: {},
      fileName: 'doc.pdf',
      allowedHosts: ['drive.example.com'],
    });

    expect(putBlobMock).toHaveBeenCalledWith(
      ctx,
      'acme',
      expect.any(Uint8Array),
      'application/pdf',
    );
    expect(store).not.toHaveBeenCalled();
    expect(res.fileId).toBe('s3:acme/uuid-2');
    expect(res.size).toBe(4);
  });
});
