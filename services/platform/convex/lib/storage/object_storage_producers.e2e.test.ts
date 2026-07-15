/**
 * E2E — the REMAINING org-owned blob producers (beyond Knowledge-Hub documents)
 * flowing through the per-org object-storage seam against a REAL S3-compatible
 * store (MinIO). Gated behind `OBJECT_STORAGE_E2E` so the ordinary unit suite
 * (no MinIO) skips it.
 *
 *   docker run -d --name minio -p 9100:9000 \
 *     -e MINIO_ROOT_USER=testkey -e MINIO_ROOT_PASSWORD=testsecret123 \
 *     minio/minio server /data        # (create a bucket `org-blobs`)
 *   OBJECT_STORAGE_E2E=1 bunx vitest --run object_storage_producers.e2e
 *
 * Each case exercises the EXACT seam calls its producer makes and asserts the
 * object is PHYSICALLY present in the org's bucket (ListObjectsV2), not merely
 * that a ref came back:
 *   - CHAT ATTACHMENT: the browser upload handoff (`generateBlobUpload`) presigns
 *     a PUT, the bytes land in the bucket, the attachment READ (`readBlobBytes`,
 *     used by the inline-image / parse / sandbox-staging paths) reads them back,
 *     the download URL (`getBlobUrl`) serves them, and delete removes them.
 *   - AUDIO BLOB: the server-side ingest store (`putBlob`, as video-link
 *     transcription does) lands the audio in the bucket, `readBlobBytes` (the
 *     `transcribeAudio` source read) reads it, and delete removes it.
 *   - SERVER-GENERATED DOCUMENT: `putBlob` (as `storeRawContent` now does) lands
 *     the blob, `readBlobBytes` (the RAG index read) reads it, delete removes it.
 *
 * The S3 arm of `blob_access` never touches the Convex `ActionCtx`, so the tests
 * pass a Proxy ctx that THROWS on any access — asserting the S3 path is ctx-free.
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
  resolveOrgObjectStore,
  s3ListObjectKeys,
  type S3ObjectStore,
} from './object_store';

const RUN = !!process.env.OBJECT_STORAGE_E2E;
const ORG = 'producers-e2e-org';
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

/** True iff an object with exactly `key` is physically present in the bucket. */
async function objectExists(
  store: S3ObjectStore,
  key: string,
): Promise<boolean> {
  const keys = await s3ListObjectKeys(store, key);
  return keys.includes(key);
}

describe.skipIf(!RUN)(
  'per-org object storage — remaining producers (MinIO)',
  () => {
    let store: S3ObjectStore;

    beforeAll(async () => {
      // Point the resolver at a throwaway TALE_CONFIG_DIR holding one org's
      // object-storage connection (plaintext secrets — no SOPS key configured).
      const root = await mkdtemp(join(tmpdir(), 'obj-store-producers-e2e-'));
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

    it('CHAT ATTACHMENT: upload handoff → PUT lands IN THE BUCKET, reads/serves/deletes', async () => {
      // The composer calls `generateBlobUpload` and PUTs the bytes (an image
      // here — the highest-volume chat attachment type).
      const handoff = await generateBlobUpload(noCtx, ORG, {
        contentType: 'image/png',
      });
      expect(handoff.method).toBe('PUT');
      const ref = handoff.s3Ref;
      expect(ref).toBeTruthy();
      if (!ref) throw new Error('handoff returned no s3Ref');

      const body = new TextEncoder().encode('PNG\x00 chat attachment bytes 🖼️');
      const put = await fetch(handoff.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body,
      });
      expect(put.ok).toBe(true);

      const parsed = parseBlobRef(ref);
      expect(parsed.backend).toBe('s3');
      if (parsed.backend !== 's3') throw new Error('ref not S3');

      // Physically present in the org's bucket.
      expect(await objectExists(store, parsed.key)).toBe(true);

      // Attachment READ path (inline image / parse / sandbox staging).
      const read = await readBlobBytes(noCtx, ORG, ref);
      expect(new TextDecoder().decode(read)).toBe(
        'PNG\x00 chat attachment bytes 🖼️',
      );

      // Download/serve path: a presigned GET a bare fetch (no signer) downloads.
      const url = await getBlobUrl(noCtx, ORG, ref, { filename: 'photo.png' });
      expect(url).toBeTruthy();
      if (!url) throw new Error('getBlobUrl returned no url');
      const served = await fetch(url);
      expect(served.ok).toBe(true);
      expect(await served.text()).toBe('PNG\x00 chat attachment bytes 🖼️');

      // Delete removes it from the bucket.
      await deleteBlob(noCtx, ORG, ref);
      expect(await objectExists(store, parsed.key)).toBe(false);
    });

    it('AUDIO BLOB: server ingest store → IN THE BUCKET → transcribe read → serve → delete', async () => {
      // Mirrors the video-link ingest store + the `transcribeAudio` source read.
      const audio = new TextEncoder().encode('OggS fake audio payload for e2e');
      const ref = await putBlob(noCtx, ORG, audio, 'audio/ogg');
      expect(typeof ref).toBe('string');
      expect(String(ref).startsWith('s3:')).toBe(true);

      const parsed = parseBlobRef(ref);
      if (parsed.backend !== 's3') throw new Error('ref not S3');
      expect(await objectExists(store, parsed.key)).toBe(true);

      // `transcribeAudio` reads the source bytes via `readBlobBytes`.
      const read = await readBlobBytes(noCtx, ORG, ref);
      expect(new TextDecoder().decode(read)).toBe(
        'OggS fake audio payload for e2e',
      );

      // Served for download (fileMetadata `getFileUrl` s3 branch).
      const url = await getBlobUrl(noCtx, ORG, ref, { filename: 'clip.ogg' });
      expect(url).toBeTruthy();
      if (!url) throw new Error('getBlobUrl returned no url');
      const served = await fetch(url);
      expect(served.ok).toBe(true);
      expect(await served.text()).toBe('OggS fake audio payload for e2e');

      await deleteBlob(noCtx, ORG, ref);
      expect(await objectExists(store, parsed.key)).toBe(false);
    });

    it('SERVER-GENERATED DOCUMENT: storeRawContent putBlob → IN THE BUCKET → read → delete', async () => {
      // Mirrors `storeRawContent` (agent-generated + knowledge-entry docs).
      const doc = new TextEncoder().encode('# Generated report\n\nbody text');
      const ref = await putBlob(noCtx, ORG, doc, 'text/markdown');
      expect(String(ref).startsWith('s3:')).toBe(true);

      const parsed = parseBlobRef(ref);
      if (parsed.backend !== 's3') throw new Error('ref not S3');
      expect(await objectExists(store, parsed.key)).toBe(true);

      const read = await readBlobBytes(noCtx, ORG, ref);
      expect(new TextDecoder().decode(read)).toBe(
        '# Generated report\n\nbody text',
      );

      await deleteBlob(noCtx, ORG, ref);
      expect(await objectExists(store, parsed.key)).toBe(false);
    });

    it('every producer namespaces its object under the org slug in the bucket', async () => {
      // Tenant isolation: the object key carries the org slug segment.
      const ref = await putBlob(
        noCtx,
        ORG,
        new Uint8Array([1, 2, 3]),
        'application/octet-stream',
      );
      const parsed = parseBlobRef(ref);
      if (parsed.backend !== 's3') throw new Error('ref not S3');
      expect(parsed.key.split('/')).toContain(ORG);
      await deleteBlob(noCtx, ORG, ref);
    });
  },
);
