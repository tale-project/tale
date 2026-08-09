/**
 * Integration test — the per-org S3 object-store verbs against a REAL
 * S3-compatible store (MinIO). Gated behind `OBJECT_STORAGE_INTEGRATION=1` so
 * the ordinary unit suite (no MinIO) skips it. Run it with:
 *
 *   docker run -d --name minio -p 9100:9000 \
 *     -e MINIO_ROOT_USER=testkey -e MINIO_ROOT_PASSWORD=testsecret123 \
 *     minio/minio server /data
 *   # (create a bucket `org-blobs`)
 *   OBJECT_STORAGE_INTEGRATION=1 bunx vitest --run object_store.integration
 *
 * Proves the whole seam an org's blobs flow through: the per-org config resolver
 * routes to the bucket, and PUT / GET / presigned-GET / DELETE round-trip on the
 * wire format the browser and RAG pipeline depend on.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  resolveOrgObjectStore,
  s3DeleteObject,
  s3GetObjectBytes,
  s3HeadObject,
  s3PresignGetUrl,
  s3PutObject,
  buildObjectKey,
  type S3ObjectStore,
} from './object_store';

const RUN = process.env.OBJECT_STORAGE_INTEGRATION === '1';
const ORG = 'testorg';

describe.skipIf(!RUN)('per-org S3 object store (MinIO round-trip)', () => {
  let store: S3ObjectStore;

  beforeAll(async () => {
    // Point the config resolver at a throwaway TALE_CONFIG_DIR holding one org's
    // object-storage connection (plaintext secrets — no SOPS key configured).
    const root = await mkdtemp(join(tmpdir(), 'obj-store-it-'));
    process.env.TALE_CONFIG_DIR = root;
    const dir = join(root, ORG, 'object-storage');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'connection.json'),
      JSON.stringify(
        {
          region: 'us-east-1',
          endpoint: 'http://127.0.0.1:9100',
          forcePathStyle: true,
          bucket: 'org-blobs',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(dir, 'connection.secrets.json'),
      JSON.stringify(
        { accessKeyId: 'testkey', secretAccessKey: 'testsecret123' },
        null,
        2,
      ),
    );
    const resolved = await resolveOrgObjectStore(ORG);
    if (resolved.backend !== 's3') {
      throw new Error('expected the org to resolve to an S3 store');
    }
    store = resolved;
  });

  afterAll(() => {
    delete process.env.TALE_CONFIG_DIR;
  });

  it('PUT then GET round-trips the exact bytes', async () => {
    const key = buildObjectKey(store, ORG);
    const body = new TextEncoder().encode('hello per-org object storage 🌍');
    await s3PutObject(store, key, body, 'text/plain; charset=utf-8');
    const got = await s3GetObjectBytes(store, key);
    expect(new TextDecoder().decode(got)).toBe(
      'hello per-org object storage 🌍',
    );
    await s3DeleteObject(store, key);
  });

  it('keeps a create-only final key immutable after a late write', async () => {
    const key = buildObjectKey(store, ORG);
    const attested = new TextEncoder().encode('attested replacement');
    const late = new TextEncoder().encode('late presigned overwrite');
    expect(
      await s3PutObject(store, key, attested, 'text/plain', {
        createOnly: true,
      }),
    ).toBe('created');
    expect(
      await s3PutObject(store, key, late, 'text/plain', {
        createOnly: true,
      }),
    ).toBe('exists');
    expect(new TextDecoder().decode(await s3GetObjectBytes(store, key))).toBe(
      'attested replacement',
    );
    await s3DeleteObject(store, key);
  });

  it('presigns a working GET URL a plain fetch can download', async () => {
    const key = buildObjectKey(store, ORG);
    await s3PutObject(
      store,
      key,
      new TextEncoder().encode('presign me'),
      'text/plain',
    );
    const url = await s3PresignGetUrl(store, key, {
      filename: 'download.txt',
    });
    // A bare fetch (no signer) must succeed purely on the query signature.
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe('presign me');
    expect(res.headers.get('content-disposition') ?? '').toContain(
      'download.txt',
    );
    await s3DeleteObject(store, key);
  });

  it('DELETE is idempotent (deleting a missing key does not throw)', async () => {
    const key = buildObjectKey(store, ORG);
    await s3PutObject(store, key, new TextEncoder().encode('x'), 'text/plain');
    await s3DeleteObject(store, key);
    await expect(s3DeleteObject(store, key)).resolves.toBeUndefined();
    // GET on the deleted key must now fail.
    await expect(s3GetObjectBytes(store, key)).rejects.toThrow();
  });

  it('the object key is namespaced under the org slug', () => {
    // `<prefix?>/<orgSlug>/<uuid>` — with no prefix configured the key starts
    // at the org segment, so match `testorg/` at start OR after a prefix slash.
    expect(buildObjectKey(store, ORG)).toMatch(new RegExp(`(^|/)${ORG}/`));
  });

  it('HEAD reports the AUTHORITATIVE byte size (not any client claim)', async () => {
    // The anti-spoof crux of #2731: a presigned PUT enforces no Content-Length,
    // so the client-declared size can't be trusted — HEAD reads the real length
    // the store recorded. A 3 MiB object HEADs as exactly 3 MiB regardless of
    // what the uploader declared, so `size > DOCUMENT_MAX_FILE_SIZE` on THIS
    // value is a truthful cap check.
    const key = buildObjectKey(store, ORG);
    const realSize = 3 * 1024 * 1024;
    await s3PutObject(store, key, new Uint8Array(realSize), 'application/pdf');
    const head = await s3HeadObject(store, key);
    expect(head?.size).toBe(realSize);
    await s3DeleteObject(store, key);
    // A missing object HEADs as null (never-uploaded / already-reclaimed).
    expect(await s3HeadObject(store, key)).toBeNull();
  });

  it('blob access refuses a key outside the org namespace (tenant isolation)', async () => {
    // Plant a real object under a DIFFERENT org's namespace in the SAME
    // bucket (the shared-bucket scenario `prefix` exists for), then prove the
    // org-scoped seam refuses to read / presign / delete it even though the
    // raw store could. Guards the client-bindable-ref hole: binding another
    // org's `s3:` key must fail closed at every access path.
    const foreignKey = 'other-org/6f9619ff-feed-beef';
    await s3PutObject(
      store,
      foreignKey,
      new TextEncoder().encode('foreign bytes'),
      'text/plain',
    );
    const { readBlobBytes, getBlobUrl, deleteBlob } =
      await import('./blob_access');
    const fakeCtx = {} as Parameters<typeof readBlobBytes>[0];
    const ref = `s3:${foreignKey}`;
    await expect(readBlobBytes(fakeCtx, ORG, ref)).rejects.toThrow(/namespace/);
    await expect(getBlobUrl(fakeCtx, ORG, ref)).rejects.toThrow(/namespace/);
    await expect(deleteBlob(fakeCtx, ORG, ref)).rejects.toThrow(/namespace/);
    // The object is untouched (refusal happened before any store call) — the
    // OWNING org's namespace check passes and can still read it.
    const raw = await s3GetObjectBytes(store, foreignKey);
    expect(new TextDecoder().decode(raw)).toBe('foreign bytes');
    await s3DeleteObject(store, foreignKey);
  });
});
