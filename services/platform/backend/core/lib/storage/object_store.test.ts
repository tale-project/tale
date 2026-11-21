import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { s3KeyBelongsToOrg } from './blob_ref';
import {
  browserFacing,
  buildObjectKey,
  buildS3ObjectStore,
  clearOrgObjectStoreCache,
  deleteOrgObject,
  locateOrgObject,
  locateOrgObjectStore,
  ObjectLengthMismatchError,
  ObjectStoreUnconfiguredError,
  ObjectTooLargeError,
  orgObjectPrefix,
  resolveOrgObjectStore,
  resolveOrgObjectStoresForRead,
  s3DeleteObject,
  s3GetObject,
  s3GetObjectStream,
  s3GetObjectToFile,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObjectStream,
  sameObjectStore,
  sharesPhysicalStore,
  type S3ObjectStore,
} from './object_store';
import {
  collectGarbage,
  startTestStore,
  type TestStore,
} from './object_store.test-helpers';

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
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('strips quotes and control characters from the filename', async () => {
    const url = new URL(
      await s3PresignGetUrl(testStore(), 'org/blob-1', {
        filename: 'a"b\r\nc d.pdf',
      }),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="a_bc d.pdf"; filename*=UTF-8''a%22bc%20d.pdf`,
    );
  });

  it('carries a non-ASCII filename exactly as filename* (RFC 6266), with an ASCII fallback', async () => {
    const url = new URL(
      await s3PresignGetUrl(testStore(), 'org/blob-1', {
        filename: 'Zürich Bericht.pdf',
      }),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="Z_rich Bericht.pdf"; filename*=UTF-8''Z%C3%BCrich%20Bericht.pdf`,
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

describe('presigned browser links on a deployment with several origins', () => {
  // The proxy publishes the bucket on every configured origin and forwards
  // the Host untouched, so a link signed for the origin the browser is on
  // verifies at the store — and the same link replayed on another host would
  // not, because the host is part of what is signed.
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'https://tale.example.com');
    vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://tale.partner.example');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function published() {
    return buildS3ObjectStore(
      {
        endpoint: 'http://object-store:9000',
        publicEndpoint: 'https://tale.example.com',
        bucket: 'tale-blobs',
        region: 'us-east-1',
        forcePathStyle: true,
      },
      { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
    );
  }

  it('signs a download for the host the browser is on', async () => {
    const url = new URL(
      await s3PresignGetUrl(
        browserFacing(published(), 'https://tale.partner.example'),
        'acme/blob-1',
      ),
    );
    expect(url.host).toBe('tale.partner.example');
    expect(url.pathname).toBe('/tale-blobs/acme/blob-1');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('signs an upload for the host the browser is on, its type still bound', async () => {
    const url = new URL(
      await s3PresignPutUrl(
        browserFacing(published(), 'https://tale.partner.example'),
        'acme/blob-1',
        { contentType: 'application/pdf' },
      ),
    );
    expect(url.host).toBe('tale.partner.example');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual([
      'content-type',
      'host',
    ]);
  });

  it('binds the signature to that host', async () => {
    const sign = async (origin: string) =>
      new URL(
        await s3PresignGetUrl(
          browserFacing(published(), origin),
          'acme/blob-1',
        ),
      );
    const canonical = await sign('https://tale.example.com');
    const partner = await sign('https://tale.partner.example');
    expect(canonical.host).toBe('tale.example.com');
    expect(canonical.searchParams.get('X-Amz-Date')).toBe(
      partner.searchParams.get('X-Amz-Date'),
    );
    expect(canonical.searchParams.get('X-Amz-Signature')).not.toBe(
      partner.searchParams.get('X-Amz-Signature'),
    );
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
            // SigV4 signing can outlast this small deadline under load.
            // Native fetch rejects an already-aborted signal immediately.
            if (request.signal.aborted) {
              reject(request.signal.reason);
            } else {
              request.signal.addEventListener(
                'abort',
                () => reject(request.signal.reason),
                { once: true },
              );
            }
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

describe('s3GetObject — a read that says the most it accepts', () => {
  /** A store whose GET answers `res`. */
  function storeAnswering(res: Response) {
    const store = testStore();
    Object.assign(store.client, { fetch: vi.fn(() => Promise.resolve(res)) });
    return store;
  }

  /** A body of `chunks`, saying how many were asked for and whether it was
   * given back. */
  function bodyOf(chunks: Uint8Array[]) {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulled];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    return { body, pulled: () => pulled, cancelled: () => cancelled };
  }

  // Regression: a limit compared after the read let an object of any size
  // into memory first. A chat image over 2 MiB, a bundle over 20 MiB, were
  // read whole, three times over, and then refused (tale-project/tale#4942).
  it('refuses an object the store declares larger, before a byte of it is read', async () => {
    const source = bodyOf([new Uint8Array(1024), new Uint8Array(1024)]);
    const attempt = s3GetObject(
      storeAnswering(
        new Response(source.body, {
          status: 200,
          headers: { 'content-length': '2048' },
        }),
      ),
      'acme/large',
      { maxBytes: 1000 },
    );

    await expect(attempt).rejects.toBeInstanceOf(ObjectTooLargeError);
    await expect(attempt).rejects.toMatchObject({ maxBytes: 1000, size: 2048 });
    // Nothing beyond what a stream queues ahead of any reader was asked for.
    expect(source.pulled()).toBeLessThanOrEqual(1);
    expect(source.cancelled()).toBe(true);
  });

  it('refuses an object that declares no length at the first chunk past the limit', async () => {
    const source = bodyOf(
      Array.from({ length: 10 }, () => new Uint8Array(400)),
    );
    const attempt = s3GetObject(
      storeAnswering(new Response(source.body, { status: 200 })),
      'acme/undeclared',
      { maxBytes: 1000 },
    );

    await expect(attempt).rejects.toMatchObject({
      name: 'ObjectTooLargeError',
      maxBytes: 1000,
      size: null,
    });
    expect(source.pulled()).toBeLessThanOrEqual(4);
    expect(source.cancelled()).toBe(true);
  });

  it('reads an object of exactly the limit, in order', async () => {
    const got = await s3GetObject(
      storeAnswering(
        new Response(
          bodyOf([new Uint8Array(600).fill(1), new Uint8Array(400).fill(2)])
            .body,
          { status: 200, headers: { 'content-length': '1000' } },
        ),
      ),
      'acme/exact',
      { maxBytes: 1000 },
    );

    expect(got.bytes.byteLength).toBe(1000);
    expect(got.bytes[0]).toBe(1);
    expect(got.bytes[999]).toBe(2);
  });

  it('reads an object with no body as empty', async () => {
    const got = await s3GetObject(
      storeAnswering(new Response(null, { status: 200 })),
      'acme/empty',
      { maxBytes: 1000 },
    );
    expect(got.bytes.byteLength).toBe(0);
  });
});

describe('s3GetObjectToFile — an object written to disk as it arrives', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'object-store-file-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A store whose GET answers `res`, and what its fetch was called with. */
  function storeAnswering(answer: (signal: AbortSignal) => Response) {
    const store = testStore();
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the verb always passes its signal
      Promise.resolve(answer(init.signal!)),
    );
    Object.assign(store.client, { fetch });
    return { store, fetch };
  }

  /** A body that sends `chunks` and then, unless told to end, stays open
   * until the request is aborted, as a store that stopped answering does. */
  function body(chunks: string[], signal: AbortSignal, end = true) {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (end) {
          controller.close();
          return;
        }
        signal.addEventListener('abort', () => controller.error(signal.reason));
      },
    });
  }

  it('writes the bytes in order and says how many, with the Content-Type the store holds', async () => {
    const { store } = storeAnswering(
      (signal) =>
        new Response(body(['first,', 'second,', 'third'], signal), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    );
    const target = path.join(dir, 'object');
    const seen = createHash('sha256');

    const got = await s3GetObjectToFile(store, 'acme/doc', target, {
      onChunk: (chunk) => seen.update(chunk),
    });

    expect(got).toEqual({ size: 18, contentType: 'text/csv' });
    expect(readFileSync(target, 'utf8')).toBe('first,second,third');
    expect(seen.digest('hex')).toBe(
      createHash('sha256').update('first,second,third').digest('hex'),
    );
  });

  it('answers null for a missing object and creates no file', async () => {
    const { store } = storeAnswering(() => new Response(null, { status: 404 }));
    const target = path.join(dir, 'object');

    expect(await s3GetObjectToFile(store, 'acme/doc', target)).toBeNull();
    expect(existsSync(target)).toBe(false);
  });

  it('throws what the store refused with, and creates no file', async () => {
    const { store } = storeAnswering(
      () =>
        new Response(
          '<Error><Code>AccessDenied</Code><Message>no</Message></Error>',
          { status: 403 },
        ),
    );
    const target = path.join(dir, 'object');

    await expect(s3GetObjectToFile(store, 'acme/doc', target)).rejects.toThrow(
      'S3 GET acme/doc failed: 403 AccessDenied: no',
    );
    expect(existsSync(target)).toBe(false);
  });

  it('ends at one byte over the most it accepts, and leaves no half-written file', async () => {
    const { store } = storeAnswering(
      (signal) =>
        new Response(body(['12345', '67890', 'x'], signal), { status: 200 }),
    );
    const target = path.join(dir, 'object');

    const refused = s3GetObjectToFile(store, 'acme/doc', target, {
      maxBytes: 10,
    });

    await expect(refused).rejects.toBeInstanceOf(ObjectTooLargeError);
    await expect(refused).rejects.toMatchObject({ maxBytes: 10 });
    expect(existsSync(target)).toBe(false);
  });

  it('accepts an object of exactly the most it accepts', async () => {
    const { store } = storeAnswering(
      (signal) => new Response(body(['12345', '67890'], signal)),
    );
    const target = path.join(dir, 'object');

    expect(
      await s3GetObjectToFile(store, 'acme/doc', target, { maxBytes: 10 }),
    ).toMatchObject({ size: 10 });
  });

  it('gives up on a body that stands still, and leaves no half-written file', async () => {
    const { store } = storeAnswering(
      (signal) => new Response(body(['some'], signal, false)),
    );
    const target = path.join(dir, 'object');

    await expect(
      s3GetObjectToFile(store, 'acme/doc', target, { stallTimeoutMs: 20 }),
    ).rejects.toThrow('S3 GET acme/doc stalled for 20 ms');
    expect(existsSync(target)).toBe(false);
  });

  it('gives up on a store that never answers its headers', async () => {
    const store = testStore();
    Object.assign(store.client, {
      fetch: vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            );
          }),
      ),
    });

    await expect(
      s3GetObjectToFile(store, 'acme/doc', path.join(dir, 'object'), {
        headerTimeoutMs: 20,
      }),
    ).rejects.toThrow('S3 GET acme/doc timed out after 20 ms');
  });

  it("stops when its caller gives up, with the caller's reason", async () => {
    const { store } = storeAnswering(
      (signal) => new Response(body(['some'], signal, false)),
    );
    const target = path.join(dir, 'object');
    const caller = new AbortController();

    const transfer = s3GetObjectToFile(store, 'acme/doc', target, {
      signal: caller.signal,
    });
    setTimeout(() => caller.abort(new Error('the job was cancelled')), 20);

    await expect(transfer).rejects.toThrow('the job was cancelled');
    expect(existsSync(target)).toBe(false);
  });

  it('never writes over a file that is already there', async () => {
    const { store } = storeAnswering(
      (signal) => new Response(body(['new'], signal)),
    );
    const target = path.join(dir, 'object');
    writeFileSync(target, 'kept');

    await expect(
      s3GetObjectToFile(store, 'acme/doc', target),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(target, 'utf8')).toBe('kept');
  });
});

describe('s3PutObjectStream — an object stored as its body is read', () => {
  let target: TestStore;
  beforeEach(async () => {
    target = await startTestStore();
  });
  afterEach(async () => {
    await target.close();
  });

  const text = (value: string): Uint8Array => new TextEncoder().encode(value);
  const filled = (length: number): Uint8Array => new Uint8Array(length).fill(7);

  /** A body that hands out `chunks` and then ends, stands still for ever,
   * or fails; it says how many chunks were asked for and whether it was
   * given back. */
  function bodyOf(
    chunks: Uint8Array[],
    then: 'end' | 'stand still' | Error = 'end',
  ) {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulled];
        if (chunk !== undefined) {
          pulled += 1;
          controller.enqueue(chunk);
          return undefined;
        }
        if (then === 'end') controller.close();
        else if (then === 'stand still') return new Promise<void>(() => {});
        else controller.error(then);
        return undefined;
      },
      cancel() {
        cancelled = true;
      },
    });
    return { body, pulled: () => pulled, cancelled: () => cancelled };
  }

  const put = (
    key: string,
    body: ReadableStream<Uint8Array>,
    contentLength: number,
    more: Partial<Parameters<typeof s3PutObjectStream>[3]> = {},
  ) =>
    s3PutObjectStream(target.store, key, body, {
      contentLength,
      contentType: 'text/csv',
      ...more,
    });

  /** Nothing is on its way to the store any more: every PUT that reached
   * it was kept, or its sender let go of the connection. A body that failed
   * before its first chunk left never reaches the store at all. */
  const settled = () =>
    vi.waitFor(() =>
      expect(target.puts.every((sent) => sent.stored || sent.dropped)).toBe(
        true,
      ),
    );

  it('stores exactly the bytes, in order, under their length and type', async () => {
    const seen = createHash('sha256');
    await put(
      'acme/whole',
      bodyOf([text('first,'), text('second,'), text('third')]).body,
      18,
      { onChunk: (chunk) => seen.update(chunk) },
    );

    expect(target.objects.get('acme/whole')).toEqual({
      bytes: Buffer.from('first,second,third'),
      contentType: 'text/csv',
    });
    // One PUT of a declared length, which is what a store takes; the body
    // is no part of the signature.
    const sent = target.puts[0]?.headers;
    expect(sent?.['content-length']).toBe('18');
    expect(sent?.['transfer-encoding']).toBeUndefined();
    expect(sent?.['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD');
    expect(sent?.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(seen.digest('hex')).toBe(
      createHash('sha256').update('first,second,third').digest('hex'),
    );
  });

  it('stores an empty object from a body with nothing in it', async () => {
    await put('acme/empty', bodyOf([]).body, 0);
    expect(target.objects.get('acme/empty')?.bytes.byteLength).toBe(0);
  });

  it('passes over a chunk with nothing in it', async () => {
    await put(
      'acme/gaps',
      bodyOf([text('ab'), new Uint8Array(0), text('cd'), new Uint8Array(0)])
        .body,
      4,
    );
    expect(target.objects.get('acme/gaps')?.bytes.toString()).toBe('abcd');
  });

  it('stores nothing of a body that ends before its declared length', async () => {
    const attempt = put(
      'acme/short',
      bodyOf([filled(60), filled(30)]).body,
      100,
    );

    await expect(attempt).rejects.toBeInstanceOf(ObjectLengthMismatchError);
    await expect(attempt).rejects.toMatchObject({
      found: 'fewer',
      contentLength: 100,
    });
    await settled();
    expect(target.objects.has('acme/short')).toBe(false);
  });

  // A store keeps an object as soon as it has the bytes it was told of, so
  // a body that goes on must be found out BEFORE those have all been sent:
  // the chunk that completes the object is held until nothing follows it.
  it('stores nothing of a body that goes on past its declared length', async () => {
    const source = bodyOf([filled(60), filled(40), filled(1)], 'stand still');
    const attempt = put('acme/long', source.body, 100);

    await expect(attempt).rejects.toMatchObject({
      name: 'ObjectLengthMismatchError',
      found: 'more',
    });
    await settled();
    expect(target.puts[0]?.received ?? 0).toBeLessThan(100);
    expect(target.objects.has('acme/long')).toBe(false);
    expect(source.cancelled()).toBe(true);
  });

  it('is not told that a body has ended by a chunk with nothing in it', async () => {
    // The declared bytes, an empty chunk, and, a while later, one byte
    // more: the empty chunk must not release the chunk that completes the
    // object, or the store has kept it by the time the byte arrives.
    const chunks = [filled(60), filled(40), new Uint8Array(0)];
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = chunks[pulled];
        pulled += 1;
        if (chunk !== undefined) {
          controller.enqueue(chunk);
          return;
        }
        if (pulled > chunks.length + 1) return new Promise<void>(() => {});
        await new Promise((resolve) => setTimeout(resolve, 150));
        controller.enqueue(filled(1));
        return undefined;
      },
    });
    const attempt = put('acme/long-after-nothing', body, 100);

    await expect(attempt).rejects.toMatchObject({ found: 'more' });
    await settled();
    expect(target.objects.has('acme/long-after-nothing')).toBe(false);
  });

  it('stores nothing of a single chunk longer than the declared length', async () => {
    const attempt = put('acme/one-long', bodyOf([filled(101)]).body, 100);

    await expect(attempt).rejects.toMatchObject({ found: 'more' });
    expect(target.objects.has('acme/one-long')).toBe(false);
  });

  it("rethrows the body's own failure as it is, and stores nothing", async () => {
    const failure = new Error('the vendor hung up');
    const attempt = put('acme/failed', bodyOf([filled(10)], failure).body, 100);

    await expect(attempt).rejects.toBe(failure);
    await settled();
    expect(target.objects.has('acme/failed')).toBe(false);
  });

  it("answers the store's refusal in the store's words, and lets the body go", async () => {
    target.behave = {
      refuse: { status: 403, code: 'AccessDenied', message: 'Access Denied.' },
    };
    const source = bodyOf(
      Array.from({ length: 16 }, () => filled(64 * 1024)),
      'stand still',
    );

    await expect(
      put('acme/refused', source.body, 2 * 1024 * 1024),
    ).rejects.toThrow(
      'S3 PUT acme/refused failed: 403 AccessDenied: Access Denied.',
    );
    expect(source.cancelled()).toBe(true);
  });

  it('gives up on a body that stands still, and lets it go', async () => {
    const source = bodyOf([filled(10)], 'stand still');
    const attempt = put('acme/stalled', source.body, 100, {
      stallTimeoutMs: 80,
    });

    await expect(attempt).rejects.toThrow(
      'S3 PUT acme/stalled stalled for 80 ms',
    );
    // A read was still out when the body was let go: an iterator would have
    // waited for it for ever.
    expect(source.cancelled()).toBe(true);
    await settled();
    expect(target.objects.has('acme/stalled')).toBe(false);
  });

  it('gives up on a store that takes the body and never answers', async () => {
    target.behave = { neverAnswer: true };

    await expect(
      put('acme/silent', bodyOf([filled(10)]).body, 10, {
        answerTimeoutMs: 80,
      }),
    ).rejects.toThrow(
      'S3 PUT acme/silent was not answered within 80 ms of its last byte',
    );
  });

  it("stops when its caller gives up, with the caller's reason", async () => {
    const caller = new AbortController();
    const reason = new Error('the browser went away');
    const source = bodyOf([filled(10)], 'stand still');
    const attempt = put('acme/given-up', source.body, 100, {
      signal: caller.signal,
    });
    setTimeout(() => caller.abort(reason), 30);

    await expect(attempt).rejects.toBe(reason);
    expect(source.cancelled()).toBe(true);
    await settled();
    expect(target.objects.has('acme/given-up')).toBe(false);
  });

  it('never starts for a caller that has already given up', async () => {
    const reason = new Error('gone before it began');
    const source = bodyOf([filled(10)], 'stand still');

    await expect(
      put('acme/never', source.body, 100, {
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(target.puts).toHaveLength(0);
    expect(source.cancelled()).toBe(true);
  });

  it('refuses a length that is no whole number of bytes', async () => {
    await expect(put('acme/odd', bodyOf([]).body, 1.5)).rejects.toThrow(
      RangeError,
    );
    await expect(put('acme/odd', bodyOf([]).body, -1)).rejects.toThrow(
      RangeError,
    );
  });

  // Regression: `fetch` keeps a second copy of a body stream, to send it
  // again should the server redirect, unless redirects are refused. The copy
  // nobody read held every chunk until the answer came, so a body that was
  // "passed on" a chunk at a time was in this process whole: 512 MiB sent
  // took 529 MiB of memory, and 29 MiB once redirects were refused.
  it('keeps nothing of the body once the store has it', async () => {
    target.behave = { countOnly: true };
    const pieceBytes = 64 * 1024;
    const pieces = 512;
    const early: WeakRef<Uint8Array>[] = [];
    let pulled = 0;
    let atHalf!: () => void;
    const half = new Promise<void>((resolve) => {
      atHalf = resolve;
    });
    let goOn!: () => void;
    const mayGoOn = new Promise<void>((resolve) => {
      goOn = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pulled === pieces) {
          controller.close();
          return;
        }
        if (pulled === pieces / 2) {
          atHalf();
          await mayGoOn;
        }
        const piece = new Uint8Array(pieceBytes);
        if (pulled < 64) early.push(new WeakRef(piece));
        pulled += 1;
        controller.enqueue(piece);
      },
    });
    const stored = put('acme/passed-on', body, pieces * pieceBytes, {
      contentType: 'application/octet-stream',
    });

    await half;
    // The first 64 pieces are with the store, and well behind what any
    // queue on the way still holds.
    await vi.waitFor(() =>
      expect(target.puts[0]?.received ?? 0).toBeGreaterThan(128 * pieceBytes),
    );
    await collectGarbage();
    expect(early.filter((piece) => piece.deref() !== undefined)).toHaveLength(
      0,
    );

    goOn();
    await stored;
    expect(target.puts[0]?.received).toBe(pieces * pieceBytes);
  });

  // The point of the verb: what is not yet sent is not yet read. 96 MiB are
  // on offer and the store reads none of it for a while; only what fits the
  // two ends of the connection has left the body by then.
  it('reads the body no faster than the store takes it', async () => {
    let read!: () => void;
    target.behave = {
      countOnly: true,
      readAfter: new Promise<void>((resolve) => {
        read = resolve;
      }),
    };
    const piece = new Uint8Array(64 * 1024);
    const pieces = 1536;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === pieces) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(piece);
      },
    });
    const stored = put('acme/large', body, pieces * piece.byteLength, {
      contentType: 'application/octet-stream',
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pulled * piece.byteLength).toBeLessThan(32 * 1024 * 1024);

    read();
    await stored;
    expect(target.puts[0]?.received).toBe(pieces * piece.byteLength);
  });
});

describe('s3GetObjectStream — an object handed on as it arrives', () => {
  let source: TestStore;
  let target: TestStore;
  beforeEach(async () => {
    source = await startTestStore();
    target = await startTestStore();
  });
  afterEach(async () => {
    await source.close();
    await target.close();
  });

  it('answers the bytes as a stream, with the Content-Type the store holds', async () => {
    source.objects.set('acme/a', {
      bytes: Buffer.from('first,second'),
      contentType: 'text/csv',
    });

    const object = await s3GetObjectStream(source.store, 'acme/a');

    expect(object?.contentType).toBe('text/csv');
    expect(await new Response(object?.body).text()).toBe('first,second');
  });

  it('answers null for a content type the store does not send', async () => {
    source.objects.set('acme/untyped', {
      bytes: Buffer.from('x'),
      contentType: null,
    });

    const object = await s3GetObjectStream(source.store, 'acme/untyped');

    expect(object?.contentType).toBeNull();
    await object?.body.cancel();
  });

  it('answers null for a missing object', async () => {
    expect(await s3GetObjectStream(source.store, 'acme/none')).toBeNull();
  });

  it('throws what the store refused with', async () => {
    const store = testStore();
    Object.assign(store.client, {
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(
            '<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>',
            { status: 403 },
          ),
        ),
      ),
    });

    await expect(s3GetObjectStream(store, 'acme/denied')).rejects.toThrow(
      'S3 GET acme/denied failed: 403 AccessDenied: Access Denied.',
    );
  });

  it('gives up on a store that never answers its headers', async () => {
    const store = testStore();
    Object.assign(store.client, {
      fetch: vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            );
          }),
      ),
    });

    await expect(
      s3GetObjectStream(store, 'acme/silent', { headerTimeoutMs: 40 }),
    ).rejects.toThrow('S3 GET acme/silent timed out after 40 ms');
  });

  it('ends the body when its caller gives up, headers or not', async () => {
    const store = testStore();
    const caller = new AbortController();
    const reason = new Error('the run was stopped');
    Object.assign(store.client, {
      fetch: vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('the first part'));
                init.signal?.addEventListener('abort', () =>
                  controller.error(init.signal?.reason),
                );
              },
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    const object = await s3GetObjectStream(store, 'acme/long', {
      signal: caller.signal,
    });
    const reader = object?.body.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe(
      'the first part',
    );
    caller.abort(reason);

    await expect(reader?.read()).rejects.toBe(reason);
  });

  // The two verbs together are a copy between stores that holds nothing of
  // the object: what the blob backfill does with every blob it moves.
  it('carries an object from one store to another, under its length and type', async () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024);
    for (let at = 0; at < bytes.byteLength; at += 4096)
      bytes.writeUInt32LE(at, at);
    source.objects.set('acme/recording', { bytes, contentType: 'video/mp4' });

    const object = await s3GetObjectStream(source.store, 'acme/recording');
    if (object === null) throw new Error('the object is in the source');
    await s3PutObjectStream(target.store, 'acme/recording', object.body, {
      contentLength: bytes.byteLength,
      contentType: object.contentType ?? 'application/octet-stream',
    });

    const landed = target.objects.get('acme/recording');
    expect(landed?.contentType).toBe('video/mp4');
    expect(landed?.bytes.equals(bytes)).toBe(true);
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

describe('s3HeadObject — size, the stored content type and the validators', () => {
  function storeAnswering(res: Response): S3ObjectStore {
    const store = testStore();
    Object.assign(store.client, { fetch: vi.fn(() => Promise.resolve(res)) });
    return store;
  }

  it('returns the size, the Content-Type and the ETag / Last-Modified the store holds', async () => {
    const store = storeAnswering(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '10',
          'content-type': 'application/pdf',
          etag: '"a63a5562abd49a61a2d7099b2e5af2bb"',
          'last-modified': 'Sat, 12 Sep 2026 05:44:01 GMT',
        },
      }),
    );
    expect(await s3HeadObject(store, 'acme/doc')).toEqual({
      size: 10,
      contentType: 'application/pdf',
      etag: '"a63a5562abd49a61a2d7099b2e5af2bb"',
      lastModified: 'Sat, 12 Sep 2026 05:44:01 GMT',
    });
  });

  it('answers null for a content type or validator the store does not send', async () => {
    const store = storeAnswering(
      new Response(null, { status: 200, headers: { 'content-length': '10' } }),
    );
    expect(await s3HeadObject(store, 'acme/doc')).toEqual({
      size: 10,
      contentType: null,
      etag: null,
      lastModified: null,
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
