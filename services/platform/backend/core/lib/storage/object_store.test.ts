import { describe, expect, it } from 'vitest';

import {
  buildS3ObjectStore,
  s3PresignGetUrl,
  s3PresignPutUrl,
} from './object_store';

function testStore() {
  return buildS3ObjectStore(
    {
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'tale-blobs',
      region: 'us-east-1',
      forcePathStyle: true,
    },
    { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  );
}

describe('s3PresignPutUrl — content-type binding', () => {
  // Regression: `opts.contentType` used to be accepted and silently ignored
  // (and aws4fetch drops `content-type` from signing unless allHeaders is
  // set), so the uploader's PUT could set ANY Content-Type — e.g. text/html,
  // which the same-origin bucket GET would then serve inline (stored XSS).
  it('signs the declared content type into X-Amz-SignedHeaders', async () => {
    const url = new URL(
      await s3PresignPutUrl(testStore(), 'org/blob-1', {
        contentType: 'application/pdf',
      }),
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
  });

  it('produces distinct signatures for distinct declared types', async () => {
    const store = testStore();
    const a = new URL(
      await s3PresignPutUrl(store, 'org/blob-1', {
        contentType: 'application/pdf',
      }),
    );
    const b = new URL(
      await s3PresignPutUrl(store, 'org/blob-1', {
        contentType: 'text/html',
      }),
    );
    expect(a.searchParams.get('X-Amz-Signature')).not.toBe(
      b.searchParams.get('X-Amz-Signature'),
    );
  });

  it('stays header-agnostic when no content type is declared', async () => {
    const url = new URL(await s3PresignPutUrl(testStore(), 'org/blob-1'));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });
});

describe('s3PresignGetUrl — attachment forcing', () => {
  // Regression: without a filename no disposition was signed at all, so a
  // navigation to the presigned URL rendered the blob inline with the
  // uploader-chosen Content-Type on the app origin.
  it('forces response-content-disposition: attachment on every URL', async () => {
    const url = new URL(await s3PresignGetUrl(testStore(), 'org/blob-1'));
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment',
    );
  });

  it('names the download when a filename is given', async () => {
    const url = new URL(
      await s3PresignGetUrl(testStore(), 'org/blob-1', {
        filename: 'report.pdf',
      }),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="report.pdf"',
    );
  });

  it('strips quotes and control characters from the filename', async () => {
    const url = new URL(
      await s3PresignGetUrl(testStore(), 'org/blob-1', {
        filename: 'a"b\r\nc d.pdf',
      }),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="abc d.pdf"',
    );
  });

  it('signs the disposition (SignedHeaders stays host-only, param is signed via query)', async () => {
    const url = new URL(await s3PresignGetUrl(testStore(), 'org/blob-1'));
    // Query-signed URL: every query param, the forced disposition included,
    // is covered by the signature — a tampered disposition invalidates it.
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
