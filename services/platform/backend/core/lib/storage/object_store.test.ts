import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildS3ObjectStore,
  clearOrgObjectStoreCache,
  deleteOrgObject,
  locateOrgObjectStore,
  ObjectStoreUnconfiguredError,
  resolveOrgObjectStore,
  resolveOrgObjectStoresForRead,
  s3GetObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  type S3ObjectStore,
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

describe('resolveOrgObjectStore — fail-closed resolution', () => {
  const previousConfigDir = process.env.TALE_CONFIG_DIR;
  let configRoot: string;

  const connectionJson = (bucket: string): string =>
    JSON.stringify({
      region: 'us-east-1',
      endpoint: 'http://minio.internal:9000',
      forcePathStyle: true,
      bucket,
    });
  const SECRETS = JSON.stringify({
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
  });

  function writeTree(
    slug: string,
    connection: string,
    secrets: string | null = SECRETS,
  ): void {
    const dir = path.join(configRoot, slug, 'object-storage');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'connection.json'), connection);
    if (secrets !== null) {
      writeFileSync(path.join(dir, 'connection.secrets.json'), secrets);
    }
  }

  beforeEach(() => {
    configRoot = mkdtempSync(path.join(tmpdir(), 'object-store-test-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgObjectStoreCache();
  });

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = previousConfigDir;
    clearOrgObjectStoreCache();
    rmSync(configRoot, { recursive: true, force: true });
  });

  // Regression: an org with no connection AND no default tree used to resolve
  // to the retired Convex backend, whose `ctx.storage.store` no longer exists
  // — the misconfiguration surfaced as a TypeError deep inside a blob lane.
  it('throws ObjectStoreUnconfiguredError when neither the org nor the default tree is configured', async () => {
    await expect(resolveOrgObjectStore('acme')).rejects.toBeInstanceOf(
      ObjectStoreUnconfiguredError,
    );
  });

  it('serves the deployment default tree to an org without its own connection', async () => {
    writeTree('default', connectionJson('default-blobs'));
    const store = await resolveOrgObjectStore('acme');
    expect(store.backend).toBe('s3');
    expect(store.config.bucket).toBe('default-blobs');
  });

  it("prefers the org's own connection over the default tree", async () => {
    writeTree('default', connectionJson('default-blobs'));
    writeTree('acme', connectionJson('acme-own-bucket'));
    const store = await resolveOrgObjectStore('acme');
    expect(store.config.bucket).toBe('acme-own-bucket');
  });

  // Regression: a broken default tree was swallowed (`.catch(() => null)`) and
  // fell through to the dead fallback; it must surface as ITS OWN error.
  it('surfaces a corrupt default connection as its own error, never a fallback', async () => {
    writeTree('default', '{"region":"us-east-1"}');
    const failure = await resolveOrgObjectStore('acme').then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ObjectStoreUnconfiguredError);
    expect(String(failure)).toMatch(/Invalid object-storage connection config/);
  });

  it('surfaces missing default credentials instead of signing with none', async () => {
    writeTree('default', connectionJson('default-blobs'), null);
    await expect(resolveOrgObjectStore('acme')).rejects.toThrow(
      /credentials missing/,
    );
  });

  it('caches a resolution until the cache is cleared', async () => {
    writeTree('default', connectionJson('default-blobs'));
    expect((await resolveOrgObjectStore('acme')).config.bucket).toBe(
      'default-blobs',
    );
    writeTree('acme', connectionJson('acme-own-bucket'));
    // Still the cached default within the TTL…
    expect((await resolveOrgObjectStore('acme')).config.bucket).toBe(
      'default-blobs',
    );
    // …and the org's own bucket once a config write clears the cache.
    clearOrgObjectStoreCache();
    expect((await resolveOrgObjectStore('acme')).config.bucket).toBe(
      'acme-own-bucket',
    );
  });
});

describe('s3GetObject — the stored content type rides with the bytes', () => {
  function storeAnswering(res: Response): S3ObjectStore {
    const store = testStore();
    Object.assign(store.client, { fetch: vi.fn(() => Promise.resolve(res)) });
    return store;
  }

  it('returns the bytes and the Content-Type the store holds', async () => {
    const store = storeAnswering(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    const got = await s3GetObject(store, 'org/blob-1');
    expect(new TextDecoder().decode(got.bytes)).toBe('pdf-bytes');
    expect(got.contentType).toBe('application/pdf');
  });

  it('answers null for a store that sends no Content-Type', async () => {
    const res = new Response('x', { status: 200 });
    res.headers.delete('content-type');
    const got = await s3GetObject(storeAnswering(res), 'org/blob-1');
    expect(got.contentType).toBeNull();
  });
});

describe('read-side store location — blobs written before the org connected its own bucket', () => {
  const previousConfigDir = process.env.TALE_CONFIG_DIR;
  let configRoot: string;

  const connectionJson = (bucket: string): string =>
    JSON.stringify({
      region: 'us-east-1',
      endpoint: 'http://minio.internal:9000',
      forcePathStyle: true,
      bucket,
    });
  const SECRETS = JSON.stringify({
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
  });

  function writeTree(slug: string, connection: string): void {
    const dir = path.join(configRoot, slug, 'object-storage');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'connection.json'), connection);
    writeFileSync(path.join(dir, 'connection.secrets.json'), SECRETS);
  }

  /** Make a store answer HEAD/GET for exactly `present` keys and record
   * every DELETE it receives. */
  function fakeBucket(store: S3ObjectStore, present: string[]): string[] {
    const deleted: string[] = [];
    Object.assign(store.client, {
      fetch: vi.fn((input: string, init?: { method?: string }) => {
        const key = decodeURIComponent(new URL(input).pathname)
          .split('/')
          .slice(2)
          .join('/');
        if (init?.method === 'DELETE') {
          deleted.push(key);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          present.includes(key)
            ? new Response('body', {
                status: 200,
                headers: { 'content-length': '4' },
              })
            : new Response(null, { status: 404 }),
        );
      }),
    });
    return deleted;
  }

  beforeEach(() => {
    configRoot = mkdtempSync(path.join(tmpdir(), 'object-store-read-test-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgObjectStoreCache();
  });

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = previousConfigDir;
    clearOrgObjectStoreCache();
    rmSync(configRoot, { recursive: true, force: true });
  });

  it('lists only the deployment default for an org without its own bucket', async () => {
    writeTree('default', connectionJson('default-blobs'));
    const stores = await resolveOrgObjectStoresForRead('acme');
    expect(stores.map((s) => s.config.bucket)).toEqual(['default-blobs']);
  });

  it('lists the own bucket first and the default store behind it', async () => {
    writeTree('default', connectionJson('default-blobs'));
    writeTree('acme', connectionJson('acme-own-bucket'));
    const stores = await resolveOrgObjectStoresForRead('acme');
    expect(stores.map((s) => s.config.bucket)).toEqual([
      'acme-own-bucket',
      'default-blobs',
    ]);
  });

  it('collapses to one store when the org connection names the default bucket', async () => {
    writeTree('default', connectionJson('shared-blobs'));
    writeTree('acme', connectionJson('shared-blobs'));
    expect(await resolveOrgObjectStoresForRead('acme')).toHaveLength(1);
  });

  it('lists only the own bucket when no default tree exists', async () => {
    writeTree('acme', connectionJson('acme-own-bucket'));
    const stores = await resolveOrgObjectStoresForRead('acme');
    expect(stores.map((s) => s.config.bucket)).toEqual(['acme-own-bucket']);
  });

  // Regression: `resolveOrgObjectStore` alone made every pre-switch blob
  // unreadable the moment an org saved its bucket connection — presigned
  // GETs 404ed until the admin discovered and finished the backfill.
  it('locates a pre-switch blob in the default store and a moved one in the org bucket', async () => {
    writeTree('default', connectionJson('default-blobs'));
    writeTree('acme', connectionJson('acme-own-bucket'));
    const [own, fallback] = await resolveOrgObjectStoresForRead('acme');
    if (own === undefined || fallback === undefined) throw new Error('setup');
    fakeBucket(own, ['acme/moved']);
    fakeBucket(fallback, ['acme/old']);

    expect((await locateOrgObjectStore('acme', 'acme/old')).config.bucket).toBe(
      'default-blobs',
    );
    expect(
      (await locateOrgObjectStore('acme', 'acme/moved')).config.bucket,
    ).toBe('acme-own-bucket');
    // Neither store holds it: the org's own store answers, so the caller's
    // verb reports the missing object exactly as it did with one store.
    expect(
      (await locateOrgObjectStore('acme', 'acme/missing')).config.bucket,
    ).toBe('acme-own-bucket');
  });

  it('does not round-trip when the org has a single store', async () => {
    writeTree('default', connectionJson('default-blobs'));
    const [only] = await resolveOrgObjectStoresForRead('acme');
    if (only === undefined) throw new Error('setup');
    const fetchSpy = vi.fn();
    Object.assign(only.client, { fetch: fetchSpy });
    await locateOrgObjectStore('acme', 'acme/anything');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deletes the blob from every store that may hold it', async () => {
    writeTree('default', connectionJson('default-blobs'));
    writeTree('acme', connectionJson('acme-own-bucket'));
    const [own, fallback] = await resolveOrgObjectStoresForRead('acme');
    if (own === undefined || fallback === undefined) throw new Error('setup');
    const ownDeleted = fakeBucket(own, []);
    const fallbackDeleted = fakeBucket(fallback, ['acme/old']);
    await deleteOrgObject('acme', 'acme/old');
    expect(ownDeleted).toEqual(['acme/old']);
    expect(fallbackDeleted).toEqual(['acme/old']);
  });

  it('still attempts every store when one delete fails, then rethrows', async () => {
    writeTree('default', connectionJson('default-blobs'));
    writeTree('acme', connectionJson('acme-own-bucket'));
    const [own, fallback] = await resolveOrgObjectStoresForRead('acme');
    if (own === undefined || fallback === undefined) throw new Error('setup');
    Object.assign(own.client, {
      fetch: vi.fn(() =>
        Promise.resolve(new Response('<Error/>', { status: 500 })),
      ),
    });
    const fallbackDeleted = fakeBucket(fallback, []);
    await expect(deleteOrgObject('acme', 'acme/old')).rejects.toThrow(
      /S3 DELETE/,
    );
    expect(fallbackDeleted).toEqual(['acme/old']);
  });
});
