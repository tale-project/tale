import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { s3KeyBelongsToOrg } from './blob_ref';
import {
  buildObjectKey,
  buildS3ObjectStore,
  clearOrgObjectStoreCache,
  deleteOrgObject,
  locateOrgObject,
  locateOrgObjectStore,
  ObjectStoreUnconfiguredError,
  orgObjectPrefix,
  resolveOrgObjectStore,
  resolveOrgObjectStoresForRead,
  s3DeleteObject,
  s3GetObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  sameObjectStore,
  sharesPhysicalStore,
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

describe('S3 verbs — bounded against a wedged or flapping store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression: the client inherited aws4fetch's default of 10 retries on
  // 5xx/429, so a 503-flapping store cost eleven attempts per verb (PUT
  // bodies re-sent every time) before the caller heard anything.
  it('gives up on a 503-flapping store after three attempts', async () => {
    const fetchStub = vi.fn(() =>
      Promise.resolve(
        new Response(
          '<Error><Code>SlowDown</Code><Message>slow down</Message></Error>',
          { status: 503 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchStub);
    await expect(s3HeadObject(testStore(), 'org/blob-1')).rejects.toThrow(
      /S3 HEAD org\/blob-1 failed: 503/,
    );
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  // Regression: no verb carried a signal, so a store that accepted the
  // connection and never answered held upload finalize / the admin probe
  // until undici's 300 s per-attempt bound.
  it('rejects within the timeout when the store never answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (request: Request) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener('abort', () =>
              reject(request.signal.reason),
            );
          }),
      ),
    );
    await expect(
      s3DeleteObject(testStore(), 'org/blob-1', { timeoutMs: 20 }),
    ).rejects.toThrow(/S3 DELETE org\/blob-1 timed out after 20 ms/);
  });
});

describe('orgObjectPrefix — the namespace every org blob is minted under', () => {
  it('is `<prefix>/<slug>/` with a configured prefix (slashes trimmed) and `<slug>/` without one', () => {
    const withPrefix = buildS3ObjectStore(
      {
        endpoint: 'http://127.0.0.1:9000',
        bucket: 'tale-blobs',
        region: 'us-east-1',
        forcePathStyle: true,
        prefix: '/tenants/',
      },
      { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
    );
    expect(orgObjectPrefix(withPrefix, 'acme')).toBe('tenants/acme/');
    expect(orgObjectPrefix(testStore(), 'acme')).toBe('acme/');
  });

  it('is exactly what buildObjectKey mints below, so a prefix listing finds every blob and only this org’s', () => {
    const store = testStore();
    const key = buildObjectKey(store, 'acme');
    expect(key.startsWith(orgObjectPrefix(store, 'acme'))).toBe(true);
    expect(key.startsWith(orgObjectPrefix(store, 'acme-2'))).toBe(false);
    expect(s3KeyBelongsToOrg(key, 'acme')).toBe(true);
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

  it('locates the object together with its HEAD, or answers null when no store holds it', async () => {
    writeTree('default', connectionJson('default-blobs'));
    writeTree('acme', connectionJson('acme-own-bucket'));
    const [own, fallback] = await resolveOrgObjectStoresForRead('acme');
    if (own === undefined || fallback === undefined) throw new Error('setup');
    fakeBucket(own, []);
    fakeBucket(fallback, ['acme/old']);
    const ownRequests = vi.spyOn(own.client, 'fetch');
    const fallbackRequests = vi.spyOn(fallback.client, 'fetch');

    const located = await locateOrgObject('acme', 'acme/old');
    expect(located?.store.config.bucket).toBe('default-blobs');
    expect(located?.head).toMatchObject({ size: 4 });
    // One HEAD per candidate store, none repeated for the located one.
    expect(ownRequests).toHaveBeenCalledTimes(1);
    expect(fallbackRequests).toHaveBeenCalledTimes(1);
    expect(await locateOrgObject('acme', 'acme/missing')).toBeNull();
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

describe('s3HeadObject — size and the stored content type', () => {
  function storeAnswering(res: Response): S3ObjectStore {
    const store = testStore();
    Object.assign(store.client, { fetch: vi.fn(() => Promise.resolve(res)) });
    return store;
  }

  it('returns the size and the Content-Type the store holds', async () => {
    const store = storeAnswering(
      new Response(null, {
        status: 200,
        headers: { 'content-length': '10', 'content-type': 'application/pdf' },
      }),
    );
    expect(await s3HeadObject(store, 'acme/doc')).toEqual({
      size: 10,
      contentType: 'application/pdf',
    });
  });

  it('answers a null content type for a store that sends none', async () => {
    const store = storeAnswering(
      new Response(null, { status: 200, headers: { 'content-length': '10' } }),
    );
    expect(await s3HeadObject(store, 'acme/doc')).toEqual({
      size: 10,
      contentType: null,
    });
  });

  it('answers null for a missing object', async () => {
    const store = storeAnswering(new Response(null, { status: 404 }));
    expect(await s3HeadObject(store, 'acme/doc')).toBeNull();
  });
});

describe('sameObjectStore — one physical bucket as far as the config can tell', () => {
  function storeOf(config: {
    bucket: string;
    region?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  }): S3ObjectStore {
    return buildS3ObjectStore(
      { region: 'us-east-1', forcePathStyle: true, ...config },
      { accessKeyId: 'k', secretAccessKey: 's' },
    );
  }

  it('sees through a trailing slash and host case in the endpoint', () => {
    const a = storeOf({ bucket: 'blobs', endpoint: 'http://minio:9000' });
    expect(
      sameObjectStore(
        a,
        storeOf({ bucket: 'blobs', endpoint: 'http://minio:9000/' }),
      ),
    ).toBe(true);
    expect(
      sameObjectStore(
        a,
        storeOf({ bucket: 'blobs', endpoint: 'HTTP://MinIO:9000' }),
      ),
    ).toBe(true);
    expect(
      sameObjectStore(
        a,
        storeOf({ bucket: 'blobs', endpoint: ' http://minio:9000 ' }),
      ),
    ).toBe(true);
  });

  it('ignores path style and region for the same bucket at the same endpoint', () => {
    const a = storeOf({
      bucket: 'blobs',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
    });
    expect(
      sameObjectStore(
        a,
        storeOf({
          bucket: 'blobs',
          endpoint: 'http://minio:9000',
          forcePathStyle: false,
          region: 'eu-central-1',
        }),
      ),
    ).toBe(true);
  });

  it('treats the same AWS bucket as one store whatever region string names it', () => {
    expect(
      sameObjectStore(
        storeOf({ bucket: 'tale-blobs', region: 'us-east-1' }),
        storeOf({ bucket: 'tale-blobs', region: 'eu-west-1' }),
      ),
    ).toBe(true);
    expect(
      sameObjectStore(
        storeOf({ bucket: 'tale-blobs', region: 'us-east-1' }),
        storeOf({ bucket: 'tale-blobs', region: 'us-east-1', endpoint: '' }),
      ),
    ).toBe(true);
  });

  it('keeps different buckets, hosts, and AWS-vs-endpoint apart', () => {
    const a = storeOf({ bucket: 'blobs', endpoint: 'http://minio:9000' });
    expect(
      sameObjectStore(
        a,
        storeOf({ bucket: 'other', endpoint: 'http://minio:9000' }),
      ),
    ).toBe(false);
    expect(
      sameObjectStore(
        a,
        storeOf({ bucket: 'blobs', endpoint: 'http://minio-2:9000' }),
      ),
    ).toBe(false);
    expect(
      sameObjectStore(
        a,
        storeOf({ bucket: 'blobs', endpoint: 'http://minio:9000/tenant' }),
      ),
    ).toBe(false);
    expect(sameObjectStore(a, storeOf({ bucket: 'blobs' }))).toBe(false);
  });
});

describe('sharesPhysicalStore — the identity probe before a destructive move', () => {
  /** A store whose requests land in `objects`; every verb is recorded. */
  function physicalStore(
    endpoint: string,
    objects: Map<string, number>,
  ): { store: S3ObjectStore; verbs: string[] } {
    const store = buildS3ObjectStore(
      { region: 'us-east-1', endpoint, bucket: 'blobs', forcePathStyle: true },
      { accessKeyId: 'k', secretAccessKey: 's' },
    );
    const verbs: string[] = [];
    Object.assign(store.client, {
      fetch: vi.fn((input: string, init?: RequestInit) => {
        const key = decodeURIComponent(new URL(input).pathname)
          .split('/')
          .slice(2)
          .join('/');
        const method = init?.method ?? 'GET';
        verbs.push(`${method} ${key}`);
        if (method === 'PUT') {
          const body: unknown = init?.body;
          if (!(body instanceof Uint8Array)) throw new Error('fake PUT body');
          objects.set(key, body.byteLength);
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        if (method === 'DELETE') {
          objects.delete(key);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        const size = objects.get(key);
        return Promise.resolve(
          size === undefined
            ? new Response(null, { status: 404 })
            : new Response(null, {
                status: 200,
                headers: { 'content-length': String(size) },
              }),
        );
      }),
    });
    return { store, verbs };
  }

  it('answers true when the marker written through the target is visible through the source, and removes it', async () => {
    const shared = new Map<string, number>([['acme/doc', 9]]);
    const source = physicalStore('http://minio:9000', shared);
    const target = physicalStore('http://minio-alias:9000', shared);

    expect(await sharesPhysicalStore(source.store, target.store, 'acme')).toBe(
      true,
    );
    expect([...shared.keys()]).toEqual(['acme/doc']);
    expect(target.verbs.map((v) => v.split(' ')[0])).toEqual(['PUT', 'DELETE']);
    expect(source.verbs).toHaveLength(1);
    expect(source.verbs[0]).toMatch(/^HEAD acme\/[0-9a-f-]{36}$/);
  });

  it('answers false for two physical buckets, and still removes the marker', async () => {
    const sourceObjects = new Map<string, number>([['acme/doc', 9]]);
    const targetObjects = new Map<string, number>();
    const source = physicalStore('http://minio:9000', sourceObjects);
    const target = physicalStore('http://minio-2:9000', targetObjects);

    expect(await sharesPhysicalStore(source.store, target.store, 'acme')).toBe(
      false,
    );
    expect(targetObjects.size).toBe(0);
    expect(target.verbs.map((v) => v.split(' ')[0])).toEqual(['PUT', 'DELETE']);
  });

  it('removes the marker even when the source HEAD fails, then surfaces the failure', async () => {
    const targetObjects = new Map<string, number>();
    const target = physicalStore('http://minio-2:9000', targetObjects);
    const source = testStore();
    Object.assign(source.client, {
      fetch: vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    });

    await expect(
      sharesPhysicalStore(source, target.store, 'acme'),
    ).rejects.toThrow(/S3 HEAD/);
    expect(targetObjects.size).toBe(0);
    expect(target.verbs.map((v) => v.split(' ')[0])).toEqual(['PUT', 'DELETE']);
  });
});
