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
});
