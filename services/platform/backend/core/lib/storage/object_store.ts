'use node';

/**
 * Per-organization object-store resolution + S3 verbs.
 *
 * The SINGLE per-org routing entry point for file blobs, the object-storage
 * analogue of `getKnowledgePoolForOrg` for the RAG corpus. S3-compatible
 * storage is THE blob backend (Convex `_storage` died with the component):
 * `resolveOrgObjectStore(orgSlug)` returns the org's own bucket when
 * `<org>/object-storage/connection.json` is configured, else the deployment
 * default — the `default` config tree's connection — and otherwise FAILS
 * CLOSED with `ObjectStoreUnconfiguredError`. There is no fallback for a
 * missing or broken connection: it is an operator-visible error at the door,
 * never a silently different backend deep in a blob lane. The one deliberate
 * second store is on READS of an existing blob: an org that connects its own
 * bucket keeps every blob written before that moment in the deployment
 * default store until the blob backfill moves it, and a ref carries no store
 * identity — so `resolveOrgObjectStoresForRead` lists own-then-default and
 * `locateOrgObjectStore` asks them in turn. Callers that hold an `ActionCtx`
 * use `blob_access.ts`; this module owns only the resolution + the raw S3
 * requests.
 *
 * S3 requests are signed with `aws4fetch` (a few-KB SigV4 signer) rather than
 * `@aws-sdk/client-s3`. Works against any S3-compatible store (AWS S3, MinIO,
 * R2, Wasabi) via `endpoint` + `forcePathStyle`.
 *
 * TENANT ISOLATION: the store is keyed strictly by `orgSlug`; a per-org bucket is
 * NEVER addressed for another org. Resolution is fail-closed — a present but
 * broken config (the org's OR the default tree's) throws rather than silently
 * using anything else.
 */

import { randomUUID } from 'node:crypto';

import { AwsClient } from 'aws4fetch';

import {
  readOrgObjectStorageConnection,
  type ObjectStorageConnectionFile,
  type ObjectStorageConnectionSecrets,
} from '../../object_storage/file_utils';

/** An S3-compatible bucket: the org's own (physical isolation) or the
 * deployment default's. */
export interface S3ObjectStore {
  backend: 's3';
  client: AwsClient;
  config: ObjectStorageConnectionFile;
}

/** Neither the org nor the deployment default tree has an object-storage
 * connection — uploads are refused until an operator configures one. */
export class ObjectStoreUnconfiguredError extends Error {
  constructor() {
    super(
      'No object storage configured: neither this org nor the deployment ' +
        'default tree has an object-storage/connection.json',
    );
    this.name = 'ObjectStoreUnconfiguredError';
  }
}

/** The config tree whose connection serves every org without its own. */
const DEFAULT_TREE_SLUG = 'default';

// Short-TTL resolution cache, mirroring `knowledge_db.ts` ORG_URL_TTL_MS: a
// config change (admin edits the org's bucket) takes effect within the TTL
// without a restart, and the hot path avoids a disk read + SOPS decrypt per blob.
const ORG_STORE_TTL_MS = 15_000;
interface CacheEntry {
  store: S3ObjectStore;
  expires: number;
}
const orgStoreCache = new Map<string, CacheEntry>();

/**
 * Resolve an org's object store: its own S3 bucket when
 * `<org>/object-storage/connection.json` is configured, else the deployment
 * default tree's connection. Cached with a short TTL. Throws (fail-closed) when
 * a present config — the org's or the default's — is invalid or its credentials
 * can't be decrypted, and `ObjectStoreUnconfiguredError` when neither exists.
 */
export async function resolveOrgObjectStore(
  orgSlug: string,
): Promise<S3ObjectStore> {
  const now = Date.now();
  const cached = orgStoreCache.get(orgSlug);
  if (cached && cached.expires > now) {
    return cached.store;
  }
  const own = await readOrgObjectStorageConnection(orgSlug);
  // A broken default tree is a real misconfiguration and must surface as its
  // own error — swallowing it here would hide "undecryptable credentials"
  // behind a generic "unconfigured" (or, historically, a dead fallback store).
  const resolved =
    own ??
    (orgSlug === DEFAULT_TREE_SLUG
      ? null
      : await readOrgObjectStorageConnection(DEFAULT_TREE_SLUG));
  if (resolved === null) {
    throw new ObjectStoreUnconfiguredError();
  }
  const store = buildS3ObjectStore(resolved.connection, resolved.secrets);
  orgStoreCache.set(orgSlug, { store, expires: now + ORG_STORE_TTL_MS });
  return store;
}

/**
 * The stores a READ (or delete) of an EXISTING org blob may find it in, most
 * likely first: the org's resolved store, then — only when the org has its
 * own bucket and the deployment default tree names a different one — the
 * default store, where every blob written before the org connected its
 * bucket still lives until the blob backfill moves it. Mint lanes never use
 * this: a new key always lands in `resolveOrgObjectStore`. A broken default
 * tree still throws (fail-closed); an absent one contributes no fallback.
 */
export async function resolveOrgObjectStoresForRead(
  orgSlug: string,
): Promise<S3ObjectStore[]> {
  const primary = await resolveOrgObjectStore(orgSlug);
  if (orgSlug === DEFAULT_TREE_SLUG) return [primary];
  let fallback: S3ObjectStore;
  try {
    fallback = await resolveOrgObjectStore(DEFAULT_TREE_SLUG);
  } catch (error) {
    if (error instanceof ObjectStoreUnconfiguredError) return [primary];
    throw error;
  }
  return sameObjectStore(primary, fallback) ? [primary] : [primary, fallback];
}

/** Two connections address the same physical bucket (a key stays one object
 * however it is signed for). */
export function sameObjectStore(a: S3ObjectStore, b: S3ObjectStore): boolean {
  return (
    a.config.bucket === b.config.bucket &&
    a.config.region === b.config.region &&
    (a.config.endpoint ?? null) === (b.config.endpoint ?? null)
  );
}

/**
 * The store that physically holds `key` for `orgSlug`: the org's store when
 * it is the only candidate (no round-trip), else the first candidate whose
 * HEAD answers — and the org's own store when none does, so a missing object
 * surfaces at the caller's verb exactly as it did with one store. Readers
 * presign, GET or HEAD against the returned store.
 */
export async function locateOrgObjectStore(
  orgSlug: string,
  key: string,
): Promise<S3ObjectStore> {
  const stores = await resolveOrgObjectStoresForRead(orgSlug);
  const primary = stores[0];
  if (primary === undefined) throw new ObjectStoreUnconfiguredError();
  if (stores.length === 1) return primary;
  for (const store of stores) {
    if ((await s3HeadObject(store, key)) !== null) return store;
  }
  return primary;
}

/**
 * DELETE `key` from every store that may hold it — S3 DELETE is idempotent,
 * so the copies a blob has in the default store and the org bucket (before,
 * during and after the backfill) all go. Every store is attempted; the first
 * failure is rethrown afterwards so a caller's best-effort/retry semantics
 * stay intact.
 */
export async function deleteOrgObject(
  orgSlug: string,
  key: string,
): Promise<void> {
  const stores = await resolveOrgObjectStoresForRead(orgSlug);
  let failure: { error: unknown } | null = null;
  for (const store of stores) {
    try {
      await s3DeleteObject(store, key);
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure !== null) throw failure.error;
}

/** Drop every cached resolution (test hook + config-write invalidation). */
export function clearOrgObjectStoreCache(): void {
  orgStoreCache.clear();
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
/**
 * The same store, addressed the way a BROWSER can reach it.
 *
 * Presigned URLs are handed to the browser on purpose — the transfer goes
 * direct, and the store (not Node) answers the Range requests media seeking
 * needs. But the store the stack ships is internal-only, so its browser URLs
 * must be signed against the origin the proxy publishes instead. Signing
 * covers host and path and the proxy rewrites neither, so the signature still
 * verifies at the store.
 *
 * A connection with no `publicEndpoint` — every BYO bucket, whose endpoint is
 * already public — is returned unchanged.
 */
export function browserFacing(store: S3ObjectStore): S3ObjectStore {
  const publicEndpoint = store.config.publicEndpoint;
  if (!publicEndpoint) return store;
  return {
    ...store,
    config: { ...store.config, endpoint: publicEndpoint },
  };
}

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

/**
 * GET an object: its raw bytes plus the Content-Type the store holds for it
 * (`null` when the store answers none) — the pair a copy between stores needs
 * to land the object as it was. Throws on a non-2xx response, 404 included.
 */
export async function s3GetObject(
  store: S3ObjectStore,
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const got = await s3GetObjectIfExists(store, key);
  if (got === null) {
    throw new Error(`S3 GET ${key} failed: 404 the object does not exist`);
  }
  return got;
}

/**
 * GET an object, distinguishing ABSENCE from failure: `null` when the store
 * answers 404, the bytes + Content-Type when it has them, a thrown error for
 * everything else (unreachable store, 5xx, a denied key). For a reader whose
 * contract treats a missing file as a legitimate state — a settings file
 * nobody has saved yet — and must not treat an outage the same way.
 */
async function s3GetObjectIfExists(
  store: S3ObjectStore,
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  const res = await store.client.fetch(objectUrl(store, key), {
    method: 'GET',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `S3 GET ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
  const contentType = res.headers.get('content-type');
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType:
      contentType === null || contentType === '' ? null : contentType,
  };
}

/** The bytes half of `s3GetObjectIfExists`: `null` on 404, thrown otherwise. */
export async function s3GetObjectBytesIfExists(
  store: S3ObjectStore,
  key: string,
): Promise<Uint8Array | null> {
  const got = await s3GetObjectIfExists(store, key);
  return got === null ? null : got.bytes;
}

/** GET the raw bytes of an object. Throws on a non-2xx response. */
export async function s3GetObjectBytes(
  store: S3ObjectStore,
  key: string,
): Promise<Uint8Array> {
  return (await s3GetObject(store, key)).bytes;
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
 * directly from the store (no proxy through the platform). `filename` names
 * the download.
 *
 * EVERY presigned GET is forced to `Content-Disposition: attachment`. On a
 * default deployment the bucket is published on the app origin (the proxy
 * forwards `/<bucket>/*` with no security headers), so an uploaded blob
 * whose stored Content-Type is text/html would otherwise render as a
 * SAME-ORIGIN document on navigation — stored XSS with full app-origin
 * reach. `attachment` affects only navigations: `<img>`/`<video>`/`<audio>`
 * embeds and `fetch()`-based previews ignore Content-Disposition, so every
 * preview lane is unchanged and only a direct click-through becomes a
 * download. The invariant: no user-uploaded bytes ever execute on the app
 * origin.
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
  // The store reflects this param as a response header — strip quotes AND
  // control chars (CR/LF/NUL…) so a hostile filename can't splice into the
  // Content-Disposition header (mirrors the WebDAV GET sanitizer).
  // oxlint-disable-next-line no-control-regex -- stripping control chars is the point
  const safeName = opts.filename?.replace(/["\u0000-\u001f\u007f]/g, '');
  url.searchParams.set(
    'response-content-disposition',
    safeName ? `attachment; filename="${safeName}"` : 'attachment',
  );
  const signed = await store.client.sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * Presign a time-limited PUT URL for the browser to upload a blob directly to
 * the org's bucket — the S3 analogue of `ctx.storage.generateUploadUrl()`.
 *
 * When `contentType` is provided it is SIGNED INTO the URL: `content-type`
 * joins `X-Amz-SignedHeaders`, so the store refuses a PUT whose actual
 * header differs. Without this, the uploader could mint a URL declaring one
 * type and land the bytes as any other (e.g. text/html, which a same-origin
 * bucket GET would serve inline — see s3PresignGetUrl). Binding requires the
 * executor to send the IDENTICAL `Content-Type` header on the PUT — every
 * in-repo executor does (browser XHR/fetch uploaders, the WebDAV service,
 * knowledge-entry blobs), and the REST API reference documents the contract
 * for external clients. A caller that passes no `contentType` gets a
 * header-agnostic URL (the REST mint without a declared type keeps working
 * for bare `curl -T` clients); the serving side neutralizes those blobs
 * regardless.
 *
 * `allHeaders: true` is load-bearing: aws4fetch lists `content-type` among
 * its UNSIGNABLE_HEADERS and would otherwise silently drop it from the
 * signature — exactly the no-op this fixes.
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
  const bindType =
    opts.contentType !== undefined && opts.contentType !== ''
      ? opts.contentType
      : null;
  const signed = await store.client.sign(url.toString(), {
    method: 'PUT',
    ...(bindType !== null ? { headers: { 'content-type': bindType } } : {}),
    aws: {
      signQuery: true,
      ...(bindType !== null ? { allHeaders: true } : {}),
    },
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
