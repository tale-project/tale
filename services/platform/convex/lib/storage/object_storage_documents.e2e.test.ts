/**
 * E2E — a Knowledge-Hub DOCUMENT blob flowing through the per-org object-storage
 * seam against a REAL S3-compatible store (MinIO). Gated behind
 * `OBJECT_STORAGE_E2E` so the ordinary unit suite (no MinIO) skips it.
 *
 *   docker run -d --name minio -p 9100:9000 \
 *     -e MINIO_ROOT_USER=testkey -e MINIO_ROOT_PASSWORD=testsecret123 \
 *     minio/minio server /data        # (create a bucket `org-blobs`)
 *   OBJECT_STORAGE_E2E=1 bunx vitest --run object_storage_documents.e2e
 *
 * Proves the EXACT seam a document upload/serve/read/delete flows through when
 * the org has a bring-your-own bucket configured:
 *   - the config resolver routes the org to its S3 bucket (not Convex _storage),
 *   - the browser upload handoff (`generateBlobUpload`) presigns a PUT and the
 *     bytes land IN THE BUCKET at the returned ref,
 *   - the RAG-read path (`readBlobBytes`) reads those bytes back,
 *   - the serve path (`getBlobUrl` → presigned GET) downloads them,
 *   - the delete path (`deleteBlob`) removes them,
 *   - and the admin test-connection probe round-trips (PUT+GET+DELETE).
 *
 * The S3 arm of `blob_access` never touches the Convex `ActionCtx`, so the tests
 * pass a Proxy ctx that THROWS on any access — asserting the S3 path is
 * ctx-free (a Convex query/mutation/action-independent seam).
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionCtx } from '../../_generated/server';
import {
  deleteBlob,
  generateBlobUpload,
  getBlobUrl,
  parseBlobRef,
  putBlob,
  readBlobBytes,
} from './blob_access';
import {
  buildS3ObjectStore,
  probeS3ObjectStore,
  resolveOrgObjectStore,
  s3GetObjectBytes,
  type S3ObjectStore,
} from './object_store';

const RUN = !!process.env.OBJECT_STORAGE_E2E;
const ORG = 'docs-e2e-org';
const ENDPOINT = 'http://127.0.0.1:9100';
const BUCKET = 'org-blobs';
const SECRETS = { accessKeyId: 'testkey', secretAccessKey: 'testsecret123' };

// A ctx the S3 path must never touch — any property access is a test failure.
const noCtx = new Proxy(
  {},
  {
    get() {
      throw new Error('the S3 blob path must not access ActionCtx');
    },
  },
) as unknown as ActionCtx;

describe.skipIf(!RUN)(
  'per-org object storage — document blob seam (MinIO)',
  () => {
    let store: S3ObjectStore;

    beforeAll(async () => {
      // Point the resolver at a throwaway TALE_CONFIG_DIR holding one org's
      // object-storage connection (plaintext secrets — no SOPS key configured).
      const root = await mkdtemp(join(tmpdir(), 'obj-store-docs-e2e-'));
      process.env.TALE_CONFIG_DIR = root;
      const dir = join(root, ORG, 'object-storage');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'connection.json'),
        JSON.stringify(
          {
            region: 'us-east-1',
            endpoint: ENDPOINT,
            forcePathStyle: true,
            bucket: BUCKET,
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(dir, 'connection.secrets.json'),
        JSON.stringify(SECRETS, null, 2),
      );

      const resolved = await resolveOrgObjectStore(ORG);
      expect(resolved.backend).toBe('s3');
      if (resolved.backend !== 's3')
        throw new Error('org did not resolve to S3');
      store = resolved;
    });

    afterAll(() => {
      delete process.env.TALE_CONFIG_DIR;
    });

    it('routes an org with a BYO bucket to S3 (not Convex _storage)', async () => {
      const resolved = await resolveOrgObjectStore(ORG);
      expect(resolved.backend).toBe('s3');
      // A DIFFERENT org with no config falls back to the Convex default.
      const other = await resolveOrgObjectStore('some-unconfigured-org');
      expect(other.backend).toBe('convex');
    });

    it('upload handoff → PUT lands the bytes IN THE BUCKET at the bound ref', async () => {
      const handoff = await generateBlobUpload(noCtx, ORG, {
        contentType: 'text/plain',
      });
      expect(handoff.method).toBe('PUT');
      const ref = handoff.s3Ref;
      expect(ref).toBeTruthy();
      if (!ref) throw new Error('handoff returned no s3Ref');

      const body = new TextEncoder().encode('per-org document source bytes 📄');
      const put = await fetch(handoff.url, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body,
      });
      expect(put.ok).toBe(true);

      // The object exists in the org's MinIO bucket at the ref's key.
      const parsed = parseBlobRef(ref);
      expect(parsed.backend).toBe('s3');
      if (parsed.backend !== 's3') throw new Error('ref not S3');
      const inBucket = await s3GetObjectBytes(store, parsed.key);
      expect(new TextDecoder().decode(inBucket)).toBe(
        'per-org document source bytes 📄',
      );

      await deleteBlob(noCtx, ORG, ref);
    });

    it('read → serve → delete round-trip through the backend-aware seam', async () => {
      // putBlob is the server-side ingest half (agent/generated docs); it must
      // also land in S3.
      const original = new TextEncoder().encode('hub doc: the quick brown fox');
      const ref = await putBlob(noCtx, ORG, original, 'text/plain');
      expect(typeof ref).toBe('string');
      expect(String(ref).startsWith('s3:')).toBe(true);

      // RAG-read path.
      const read = await readBlobBytes(noCtx, ORG, ref);
      expect(new TextDecoder().decode(read)).toBe(
        'hub doc: the quick brown fox',
      );

      // Serve path: a presigned GET a bare fetch (no signer) can download.
      const url = await getBlobUrl(noCtx, ORG, ref, { filename: 'report.txt' });
      expect(url).toBeTruthy();
      if (!url) throw new Error('getBlobUrl returned no url');
      const served = await fetch(url);
      expect(served.ok).toBe(true);
      expect(await served.text()).toBe('hub doc: the quick brown fox');
      expect(served.headers.get('content-disposition') ?? '').toContain(
        'report.txt',
      );

      // Delete path removes it from the bucket.
      await deleteBlob(noCtx, ORG, ref);
      const parsed = parseBlobRef(ref);
      if (parsed.backend !== 's3') throw new Error('ref not S3');
      await expect(s3GetObjectBytes(store, parsed.key)).rejects.toThrow();
    });

    it('admin test-connection probe round-trips (PUT+GET+DELETE) and rejects bad creds', async () => {
      // Good creds: a real probe object round-trip against the bucket.
      const good = buildS3ObjectStore(
        {
          region: 'us-east-1',
          endpoint: ENDPOINT,
          forcePathStyle: true,
          bucket: BUCKET,
        },
        SECRETS,
      );
      await expect(probeS3ObjectStore(good)).resolves.toBeUndefined();

      // Wrong secret: the probe must fail (proves the probe truly exercises S3).
      const bad = buildS3ObjectStore(
        {
          region: 'us-east-1',
          endpoint: ENDPOINT,
          forcePathStyle: true,
          bucket: BUCKET,
        },
        { accessKeyId: 'testkey', secretAccessKey: 'wrong-secret' },
      );
      await expect(probeS3ObjectStore(bad)).rejects.toThrow();
    });
  },
);
