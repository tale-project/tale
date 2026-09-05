import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { s3KeyBelongsToOrg } from './blob_ref';
import {
  buildObjectKey,
  buildS3ObjectStore,
  clearOrgObjectStoreCache,
  ObjectStoreUnconfiguredError,
  orgObjectPrefix,
  resolveOrgObjectStore,
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
