'use node';

/**
 * Per-organization object-store resolution + S3 verbs.
 *
 * The SINGLE per-org routing entry point for file blobs, the object-storage
 * analogue of `getKnowledgePoolForOrg` for the RAG corpus. `resolveOrgObjectStore
 * (orgSlug)` returns either the deployment default (Convex `_storage` — today's
 * behaviour, zero regression) or, when the org has configured
 * `<org>/object-storage/connection.json`, an S3 backend addressing the org's own
 * bucket. Callers that hold an `ActionCtx` use `blob_access.ts`, which routes
 * `ctx.storage.*` vs. these S3 verbs off the resolved backend; this module owns
 * only the resolution + the raw S3 requests.
 *
 * S3 requests are signed with `aws4fetch` (a few-KB SigV4 signer) rather than
 * `@aws-sdk/client-s3` — the AWS SDK is large and would risk the Convex module
 * push-size cap. Works against any S3-compatible store (AWS S3, MinIO, R2,
 * Wasabi) via `endpoint` + `forcePathStyle`.
 *
 * TENANT ISOLATION: the store is keyed strictly by `orgSlug`; a per-org bucket is
 * NEVER addressed for another org. Resolution is fail-closed — a present but
 * broken per-org config throws rather than silently using the shared default.
 */

import { randomUUID } from 'node:crypto';

import { AwsClient } from 'aws4fetch';

import {
  readOrgObjectStorageConnection,
  type ObjectStorageConnectionFile,
  type ObjectStorageConnectionSecrets,
} from '../../object_storage/file_utils';

/** Deployment default: blobs live in Convex `_storage` (per-org logical scope). */
export interface ConvexObjectStore {
  backend: 'convex';
}

/** Per-org bring-your-own S3-compatible bucket (physical isolation). */
export interface S3ObjectStore {
  backend: 's3';
  client: AwsClient;
  config: ObjectStorageConnectionFile;
}

export type ResolvedObjectStore = ConvexObjectStore | S3ObjectStore;

const CONVEX_STORE: ConvexObjectStore = { backend: 'convex' };

// Short-TTL resolution cache, mirroring `knowledge_db.ts` ORG_URL_TTL_MS: a
// config change (admin edits the org's bucket) takes effect within the TTL
// without a restart, and the hot path avoids a disk read + SOPS decrypt per blob.
const ORG_STORE_TTL_MS = 15_000;
interface CacheEntry {
  store: ResolvedObjectStore;
  expires: number;
}
const orgStoreCache = new Map<string, CacheEntry>();

/**
 * Resolve an org's object store: its own S3 bucket when
 * `<org>/object-storage/connection.json` is configured, else the deployment
 * default (Convex `_storage`). Cached with a short TTL. Throws (fail-closed) if a
 * present per-org config is invalid or its credentials can't be decrypted.
 */
export async function resolveOrgObjectStore(
  orgSlug: string,
): Promise<ResolvedObjectStore> {
  const now = Date.now();
  const cached = orgStoreCache.get(orgSlug);
  if (cached && cached.expires > now) {
    return cached.store;
  }
  const resolved = await readOrgObjectStorageConnection(orgSlug);
  let store: ResolvedObjectStore;
  if (resolved === null) {
    store = CONVEX_STORE;
  } else {
    store = buildS3ObjectStore(resolved.connection, resolved.secrets);
    console.info(`Resolved per-org S3 object store for org '${orgSlug}'`);
  }
  orgStoreCache.set(orgSlug, { store, expires: now + ORG_STORE_TTL_MS });
  return store;
}

/**
 * Build an `S3ObjectStore` from a connection + credentials WITHOUT touching disk
 * — the shared constructor for both `resolveOrgObjectStore` (which reads the
 * org's config) and the admin test-connection probe (which validates values
 * from the form before they are ever persisted).
 */
export function buildS3ObjectStore(
  connection: ObjectStorageConnectionFile,
  secrets: ObjectStorageConnectionSecrets,
): S3ObjectStore {
  return {
    backend: 's3',
    client: new AwsClient({
      accessKeyId: secrets.accessKeyId,
      secretAccessKey: secrets.secretAccessKey,
      region: connection.region,
      service: 's3',
    }),
    config: connection,
  };
}

/**
 * Round-trip a throwaway probe object (PUT → GET → DELETE) against the store to
 * prove the credentials AND the bucket are usable before the admin saves the
 * config. Throws on any step failure (surfaced to the admin as the test result);
 * always attempts the cleanup DELETE even when the GET assertion fails.
 */
export async function probeS3ObjectStore(store: S3ObjectStore): Promise<void> {
  const key = buildObjectKey(store, '__tale_probe__');
  const expected = `tale-object-storage-probe ${new Date().toISOString()}`;
  const body = new TextEncoder().encode(expected);
  await s3PutObject(store, key, body, 'text/plain; charset=utf-8');
  try {
    const got = await s3GetObjectBytes(store, key);
    if (new TextDecoder().decode(got) !== expected) {
      throw new Error('probe object read back with unexpected content');
    }
  } finally {
    await s3DeleteObject(store, key);
  }
}

/** Drop the cached store resolution for an org (call after a config change). */
export function invalidateOrgObjectStore(orgSlug: string): void {
  orgStoreCache.delete(orgSlug);
}

/**
 * Build the S3 object URL for a key, honouring path-style (MinIO/R2) vs.
 * virtual-host (AWS) addressing. The key is percent-encoded per path segment
 * (S3 keys may contain `/`, which stays a separator).
 */
export function objectUrl(store: S3ObjectStore, key: string): string {
  const encodedKey = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const { bucket, endpoint, forcePathStyle, region } = store.config;
  if (endpoint) {
    const base = endpoint.replace(/\/+$/, '');
    if (forcePathStyle) {
      return `${base}/${encodeURIComponent(bucket)}/${encodedKey}`;
    }
    const u = new URL(base);
    return `${u.protocol}//${bucket}.${u.host}/${encodedKey}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

/**
 * List the object keys physically present in the store under an optional
 * `prefix` (S3 ListObjectsV2). Diagnostic/verification helper — proves a blob is
 * really in the bucket rather than trusting a returned ref. Handles the (rare)
 * multi-page case by following the continuation token.
 */
export async function s3ListObjectKeys(
  store: S3ObjectStore,
  prefix?: string,
): Promise<string[]> {
  // `objectUrl(store, '')` yields the bucket base with a trailing slash; strip
  // it so the list query targets the bucket, not a phantom empty-key object.
  const bucketBase = objectUrl(store, '').replace(/\/+$/, '');
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const url = new URL(bucketBase);
    url.searchParams.set('list-type', '2');
    if (prefix) url.searchParams.set('prefix', prefix);
    if (continuationToken)
      url.searchParams.set('continuation-token', continuationToken);
    const res = await store.client.fetch(url.toString(), { method: 'GET' });
    if (!res.ok) {
      throw new Error(
        `S3 LIST failed: ${res.status} ${await safeErrorBody(res)}`,
      );
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(
        m[1]
          .replaceAll('&amp;', '&')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>'),
      );
    }
    const tokenMatch =
      /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    continuationToken = tokenMatch ? tokenMatch[1] : undefined;
  } while (continuationToken);
  return keys;
}

/**
 * Namespaced object key for an org's blob. `<prefix>/<orgSlug>/<uuid>` — the
 * `orgSlug` segment keeps blobs legible/auditable inside a bucket even though a
 * per-org bucket is already dedicated; `prefix` is the org-chosen namespace.
 */
export function buildObjectKey(store: S3ObjectStore, orgSlug: string): string {
  const prefix = store.config.prefix?.replace(/^\/+|\/+$/g, '');
  const parts = [prefix, orgSlug, randomUUID()].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.join('/');
}

/** PUT bytes to the org's bucket. Throws on a non-2xx response. */
export async function s3PutObject(
  store: S3ObjectStore,
  key: string,
  body: Uint8Array,
  contentType: string,
  opts: { createOnly?: boolean } = {},
): Promise<'created' | 'exists'> {
  const res = await store.client.fetch(objectUrl(store, key), {
    method: 'PUT',
    // aws4fetch hashes the Uint8Array body for SigV4 (it checks `byteLength`);
    // the cast is only to bridge TS 5.7's `Uint8Array<ArrayBufferLike>` vs the
    // DOM `BufferSource` shape — it is a valid `BodyInit` at runtime.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- valid BodyInit at runtime (see above)
    body: body as BodyInit,
    headers: {
      'content-type': contentType,
      ...(opts.createOnly ? { 'if-none-match': '*' } : {}),
    },
  });
  if (opts.createOnly && res.status === 412) return 'exists';
  if (!res.ok) {
    throw new Error(
      `S3 PUT ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
  return 'created';
}

/** GET the raw bytes of an object. Throws on a non-2xx response. */
export async function s3GetObjectBytes(
  store: S3ObjectStore,
  key: string,
): Promise<Uint8Array> {
  const res = await store.client.fetch(objectUrl(store, key), {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error(
      `S3 GET ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * HEAD an object → its size in bytes (the authoritative server-side length).
 * Used to verify an `s3:` upload's real size against the product cap — a
 * presigned PUT enforces no Content-Length, so the client-declared size can't
 * be trusted. Returns `null` when the object is missing (404).
 */
export async function s3HeadObject(
  store: S3ObjectStore,
  key: string,
): Promise<{ size: number } | null> {
  const res = await store.client.fetch(objectUrl(store, key), {
    method: 'HEAD',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`S3 HEAD ${key} failed: ${res.status}`);
  }
  const len = res.headers.get('content-length');
  const size = len === null ? NaN : Number(len);
  if (!Number.isFinite(size)) {
    throw new Error(`S3 HEAD ${key} returned no usable content-length`);
  }
  return { size };
}

/** DELETE an object. S3 DELETE is idempotent (204 whether or not it existed). */
export async function s3DeleteObject(
  store: S3ObjectStore,
  key: string,
): Promise<void> {
  const res = await store.client.fetch(objectUrl(store, key), {
    method: 'DELETE',
  });
  // 204 (deleted) and 404 (already gone) are both success for our purposes.
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `S3 DELETE ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
}

/** Default presigned-URL lifetime (seconds) — long enough for a browser fetch. */
export const DEFAULT_PRESIGN_TTL_SEC = 15 * 60;

/**
 * Presign a time-limited GET URL for the browser to download the object
 * directly from the store (no proxy through the platform). `filename` sets a
 * `Content-Disposition: attachment` so the download names the file.
 */
export async function s3PresignGetUrl(
  store: S3ObjectStore,
  key: string,
  opts: { filename?: string; expiresInSec?: number } = {},
): Promise<string> {
  const url = new URL(objectUrl(store, key));
  url.searchParams.set(
    'X-Amz-Expires',
    String(opts.expiresInSec ?? DEFAULT_PRESIGN_TTL_SEC),
  );
  if (opts.filename) {
    // The store reflects this param as a response header — strip quotes AND
    // control chars (CR/LF/NUL…) so a hostile filename can't splice into the
    // Content-Disposition header (mirrors the `/storage` route's sanitizer).
    // oxlint-disable-next-line no-control-regex -- stripping control chars is the point
    const safeName = opts.filename.replace(/["\u0000-\u001f\u007f]/g, '');
    url.searchParams.set(
      'response-content-disposition',
      `attachment; filename="${safeName}"`,
    );
  }
  const signed = await store.client.sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * Presign a time-limited PUT URL for the browser to upload a blob directly to
 * the org's bucket — the S3 analogue of `ctx.storage.generateUploadUrl()`.
 */
export async function s3PresignPutUrl(
  store: S3ObjectStore,
  key: string,
  opts: { contentType?: string; expiresInSec?: number } = {},
): Promise<string> {
  const url = new URL(objectUrl(store, key));
  url.searchParams.set(
    'X-Amz-Expires',
    String(opts.expiresInSec ?? DEFAULT_PRESIGN_TTL_SEC),
  );
  const signed = await store.client.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * Summarize an S3 error response for diagnostics (never throws). S3-compatible
 * stores answer failures with an XML `<Error><Code>…</Code><Message>…</Message>`
 * document; surfacing the parsed `Code`/`Message` gives a legible one-liner
 * (e.g. `SignatureDoesNotMatch: The request signature we calculated…`) instead
 * of a raw XML blob that the admin form truncates mid-tag. Falls back to a
 * trimmed slice of the raw body when the payload isn't the expected XML shape.
 */
async function safeErrorBody(res: Response): Promise<string> {
  try {
    const body = await res.text();
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1]?.trim();
    const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1]?.trim();
    if (code && message) return `${code}: ${message}`;
    if (code) return code;
    if (message) return message;
    return body.trim().slice(0, 300);
  } catch {
    return '(unreadable body)';
  }
}
