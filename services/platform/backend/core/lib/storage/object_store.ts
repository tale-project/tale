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

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { AwsClient } from 'aws4fetch';

import { FILE_LINK_LIFETIME_SEC } from '../../../../lib/shared/constants/file-links';
import { attachmentDisposition } from '../../../../lib/shared/http/content-disposition';
import {
  readOrgObjectStorageConnection,
  type ObjectStorageConnectionFile,
  type ObjectStorageConnectionSecrets,
} from '../../object_storage/file_utils';
import { siteOrigins } from '../helpers/public_origin';

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

/**
 * Network bounds for every S3 verb. Without them a store that accepts the
 * connection and then stalls holds the caller — upload finalize, a document
 * replacement, the admin test-connection click — until undici's 300 s
 * per-attempt bound, and aws4fetch's DEFAULT of 10 retries turns a
 * 503-flapping store into eleven attempts per verb (whole PUT bodies
 * re-sent each time). Three attempts is enough to ride out one blip; a
 * store that is down stays down. The timeout is the TOTAL wall clock across
 * retries, per call: metadata verbs (HEAD/DELETE) carry no body and must
 * answer fast; body verbs (PUT/GET) get room for a large object on a slow
 * link. Every verb takes `opts.timeoutMs` for a caller with a tighter or
 * looser budget.
 */
const S3_RETRIES = 2;
const S3_METADATA_TIMEOUT_MS = 30_000;
const S3_BODY_TIMEOUT_MS = 120_000;

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

/**
 * The endpoint an object request really goes to, in one spelling: parsed as
 * a URL (host case-folded, a trailing slash dropped — `objectUrl` strips it
 * too) so `http://minio:9000/` and `http://MinIO:9000` compare equal; an
 * endpoint that does not parse is compared trimmed and case-folded. `null`
 * for the AWS default.
 */
function endpointIdentity(endpoint: string | undefined): string | null {
  if (endpoint === undefined) return null;
  const trimmed = endpoint.trim();
  if (trimmed === '') return null;
  if (!URL.canParse(trimmed)) {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
  const u = new URL(trimmed);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Two connections address the same physical bucket as far as their CONFIG
 * can tell (a key stays one object however it is signed for): the same
 * bucket at the same endpoint identity, or — with no endpoint on either
 * side — the same bucket on AWS, where bucket names are global and the
 * region string only says where the client looks first. Path-style is a
 * request-shape choice, not a different store. A config compare cannot see
 * DNS aliases or a proxy in front of the same bucket; a lane that DELETES
 * on the strength of "different stores" probes with `sharesPhysicalStore`.
 */
export function sameObjectStore(a: S3ObjectStore, b: S3ObjectStore): boolean {
  if (a.config.bucket !== b.config.bucket) return false;
  const endpointA = endpointIdentity(a.config.endpoint);
  const endpointB = endpointIdentity(b.config.endpoint);
  if (endpointA === null && endpointB === null) return true;
  return endpointA === endpointB;
}

/**
 * Whether `source` and `target` are ONE physical bucket, proven rather than
 * inferred: a marker object written through `target` under a fresh
 * org-namespaced key must be invisible through `source`. Every alias the
 * config compare is blind to — a trailing slash, a DNS name for the same
 * host, a proxy, an AWS bucket reached through two endpoint strings — makes
 * the marker show up on both sides. The marker is deleted again on every
 * path; a PUT or DELETE failure surfaces to the caller. For a lane that is
 * about to delete a source copy on the strength of "the target is a
 * different store".
 */
export async function sharesPhysicalStore(
  source: S3ObjectStore,
  target: S3ObjectStore,
  orgSlug: string,
): Promise<boolean> {
  const key = buildObjectKey(target, orgSlug);
  const body = new TextEncoder().encode(
    `tale-object-storage-identity-probe ${new Date().toISOString()}`,
  );
  await s3PutObject(target, key, body, 'text/plain; charset=utf-8');
  try {
    return (await s3HeadObject(source, key)) !== null;
  } finally {
    await s3DeleteObject(target, key);
  }
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
  return (await locateAmong(stores, key))?.store ?? primary;
}

/**
 * `locateOrgObjectStore` for a reader that needs the object's HEAD anyway:
 * the store holding `key` together with that HEAD, in ONE round-trip per
 * candidate store, or `null` when no store holds it. Saves the second HEAD
 * a caller would otherwise issue against the located store.
 */
export async function locateOrgObject(
  orgSlug: string,
  key: string,
): Promise<{ store: S3ObjectStore; head: S3ObjectHead } | null> {
  const stores = await resolveOrgObjectStoresForRead(orgSlug);
  if (stores[0] === undefined) throw new ObjectStoreUnconfiguredError();
  return locateAmong(stores, key);
}

async function locateAmong(
  stores: S3ObjectStore[],
  key: string,
): Promise<{ store: S3ObjectStore; head: S3ObjectHead } | null> {
  for (const store of stores) {
    const head = await s3HeadObject(store, key);
    if (head !== null) return { store, head };
  }
  return null;
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
      retries: S3_RETRIES,
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
 * The same store, addressed the way a BROWSER on `requestOrigin` can reach it.
 *
 * Presigned URLs are handed to the browser on purpose — the transfer goes
 * direct, and the store (not Node) answers the Range requests media seeking
 * needs. But the store the stack ships is internal-only, so its browser URLs
 * must be signed against the origin the proxy publishes instead. Signing
 * covers host and path and the proxy rewrites neither, so the signature still
 * verifies at the store.
 *
 * A deployment served from several origins publishes the bucket path on every
 * one of them, so the published endpoint moves onto the origin the request
 * arrived on (`publicOrigin(req)`) when both are configured site origins:
 * uploads, previews and media stay same-origin wherever the browser is,
 * instead of crossing to the canonical host without its session. A separate
 * file host, an origin outside the configured set, and a caller with no
 * browser request (`null`) keep the configured endpoint.
 *
 * A connection with no `publicEndpoint` — every BYO bucket, whose endpoint is
 * already public — is returned unchanged.
 */
export function browserFacing(
  store: S3ObjectStore,
  requestOrigin: string | null,
): S3ObjectStore {
  const publicEndpoint = store.config.publicEndpoint;
  if (!publicEndpoint) return store;
  return {
    ...store,
    config: {
      ...store.config,
      endpoint: endpointForOrigin(publicEndpoint, requestOrigin),
    },
  };
}

/**
 * `publicEndpoint` moved onto `requestOrigin`, its path kept, when both name
 * configured site origins — otherwise `publicEndpoint` itself.
 */
function endpointForOrigin(
  publicEndpoint: string,
  requestOrigin: string | null,
): string {
  if (requestOrigin === null || !URL.canParse(publicEndpoint)) {
    return publicEndpoint;
  }
  const endpoint = new URL(publicEndpoint);
  const origins = siteOrigins();
  if (
    endpoint.origin === requestOrigin ||
    !origins.includes(endpoint.origin) ||
    !origins.includes(requestOrigin)
  ) {
    return publicEndpoint;
  }
  return `${requestOrigin}${endpoint.pathname.replace(/\/+$/, '')}`;
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
    const res = await store.client.fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(S3_METADATA_TIMEOUT_MS),
    });
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
 * The key prefix under which EVERY blob of an org lives: `<prefix>/<orgSlug>/`
 * (or `<orgSlug>/` without a configured prefix). `buildObjectKey` mints below
 * it and the org teardown lists and deletes exactly it, so the two cannot
 * drift apart.
 */
export function orgObjectPrefix(store: S3ObjectStore, orgSlug: string): string {
  const prefix = store.config.prefix?.replace(/^\/+|\/+$/g, '');
  const parts = [prefix, orgSlug].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return `${parts.join('/')}/`;
}

/**
 * Namespaced object key for an org's blob. `<prefix>/<orgSlug>/<uuid>` — the
 * `orgSlug` segment keeps blobs legible/auditable inside a bucket even though a
 * per-org bucket is already dedicated; `prefix` is the org-chosen namespace.
 */
export function buildObjectKey(store: S3ObjectStore, orgSlug: string): string {
  return `${orgObjectPrefix(store, orgSlug)}${randomUUID()}`;
}

/** Per-call override of the verb's default network bound (see `S3_RETRIES`). */
interface S3TimeoutOpts {
  timeoutMs?: number;
}

/** What a read of a whole object may be told. */
export interface S3ReadOpts extends S3TimeoutOpts {
  /**
   * The most bytes the caller accepts. An object that holds more ends the
   * read with {@link ObjectTooLargeError}: on the length the store declares,
   * before a byte is read, and otherwise at the first chunk past the limit.
   * A caller with a limit says it here: compared after the read, a limit of
   * two megabytes has let an object of five hundred into memory first.
   */
  maxBytes?: number;
}

/**
 * The ONE door every S3 verb goes through: the signed request with a total
 * timeout covering aws4fetch's retry loop. An abort surfaces as a legible
 * `S3 <verb> <key> timed out after N ms` instead of a bare `TimeoutError`
 * from deep inside undici.
 */
async function s3Fetch(
  store: S3ObjectStore,
  key: string,
  verb: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
  init: Omit<RequestInit, 'method' | 'signal'>,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await store.client.fetch(objectUrl(store, key), {
      ...init,
      method: verb,
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`S3 ${verb} ${key} timed out after ${timeoutMs} ms`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** PUT bytes to the org's bucket. Throws on a non-2xx response. */
export async function s3PutObject(
  store: S3ObjectStore,
  key: string,
  body: Uint8Array,
  contentType: string,
  opts: { createOnly?: boolean } & S3TimeoutOpts = {},
): Promise<'created' | 'exists'> {
  const res = await s3Fetch(
    store,
    key,
    'PUT',
    {
      // The body is not part of the signature: for S3 aws4fetch signs the
      // headers with `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD`. The cast is
      // only to bridge TS 5.7's `Uint8Array<ArrayBufferLike>` vs the
      // aws4fetch's declaration uses the DOM `BodyInit` shape. The Bun
      // compiler models this view as `Uint8Array<ArrayBufferLike>`, while the
      // signer accepts the same bytes at runtime as an ArrayBuffer-backed
      // view. Keep the assertion at this package boundary rather than making
      // every object-store caller carry the dependency's DOM type.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- valid BodyInit at runtime (see above)
      body: body as Uint8Array<ArrayBuffer>,
      headers: {
        'content-type': contentType,
        ...(opts.createOnly ? { 'if-none-match': '*' } : {}),
      },
    },
    opts.timeoutMs ?? S3_BODY_TIMEOUT_MS,
  );
  if (opts.createOnly && res.status === 412) return 'exists';
  if (!res.ok) {
    throw new Error(
      `S3 PUT ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
  return 'created';
}

/** A streamed PUT was handed a body that is not as long as it was said to
 * be. Nothing was stored. */
export class ObjectLengthMismatchError extends Error {
  readonly contentLength: number;
  /** Whether the body ended early or went on. */
  readonly found: 'fewer' | 'more';

  constructor(key: string, contentLength: number, found: 'fewer' | 'more') {
    super(
      `S3 PUT ${key} was handed ${found} than the ${contentLength} bytes it was told of`,
    );
    this.name = 'ObjectLengthMismatchError';
    this.contentLength = contentLength;
    this.found = found;
  }
}

export interface S3PutStreamOpts {
  /** How many bytes the body holds. A store takes a body only with its
   * length (it answers one without `411 MissingContentLength`, or drops
   * the connection), so a body whose length is unknown goes to a file
   * first. */
  contentLength: number;
  contentType: string;
  /** Ends the transfer when the caller gives up; its reason is rethrown. */
  signal?: AbortSignal;
  /** Sees every chunk, in order, as it is sent: a hash of the object. */
  onChunk?: (chunk: Uint8Array) => void;
  /** How long the body may stand still before the transfer is given up. */
  stallTimeoutMs?: number;
  /** How long the store may take to answer once it has been sent the last
   * byte. */
  answerTimeoutMs?: number;
  /** Store the object only where the key holds none: a key that is taken
   * keeps what it has, and the answer is `'exists'`. */
  createOnly?: boolean;
}

/** A file's bytes as a body for {@link s3PutObjectStream}, read as they are
 * sent. Cancelling the stream closes the file. */
export function fileBody(filePath: string): ReadableStream<Uint8Array> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- node's web stream of a file hands out Buffers, which are byte arrays
  return Readable.toWeb(
    createReadStream(filePath),
  ) as unknown as ReadableStream<Uint8Array>;
}

/**
 * PUT an object from a body that is read as it is sent. The object is never
 * held whole in memory, so a process stores one larger than the memory it
 * has left (tale-project/tale#4942): an upload goes from the browser to the
 * store, an import from the vendor to the store, a file from the disk.
 *
 * The body is a stream: a request's or a response's, or a file being read.
 * It is cancelled when the transfer ends, however it ends, which gives a
 * request its socket back and a file its descriptor. It is read through a
 * reader and not as an iterator: an iterator's `return()` waits for the read
 * that is still out, so a body that stood still could never be let go.
 *
 * Exactly `contentLength` bytes are stored, or nothing: a store keeps the
 * object as soon as it has the bytes it was told of, so the chunk that
 * completes it is sent only once the body is known to have ended there. A
 * body that ends early or goes on is {@link ObjectLengthMismatchError}; the
 * body's own failure is rethrown as it is, and so is the reason of a caller
 * that gave up. Every other failure is the store's.
 *
 * Sent once: a body that has been read cannot be sent again, so the retries
 * the other verbs make do not apply. Bounded by progress, as
 * {@link s3GetObjectToFile} is, and then by how long the store takes to
 * answer its last byte.
 *
 * `'created'`, or with `createOnly` `'exists'` for a key that already holds
 * an object: that object is left as it is, as {@link s3PutObject} leaves it.
 * A store is free to refuse such a key without waiting for the body, and
 * not every store's refusal can be read by a sender that is still sending:
 * MinIO's 412 arrives, versitygw closes the connection under the body. So a
 * create-only transfer that failed asks what the key holds, and an object
 * there is the answer `'exists'`, whoever wrote it. The caller checks what
 * it finds there, as it must after any `'exists'`.
 */
export async function s3PutObjectStream(
  store: S3ObjectStore,
  key: string,
  body: ReadableStream<Uint8Array>,
  opts: S3PutStreamOpts,
): Promise<'created' | 'exists'> {
  const { contentLength } = opts;
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new RangeError(
      `S3 PUT ${key} needs a whole number of bytes, not ${contentLength}`,
    );
  }
  const stallTimeoutMs = opts.stallTimeoutMs ?? S3_BODY_TIMEOUT_MS;
  const answerTimeoutMs = opts.answerTimeoutMs ?? S3_BODY_TIMEOUT_MS;
  const controller = new AbortController();
  const giveUp = (why: string): void =>
    controller.abort(new Error(`S3 PUT ${key} ${why}`));
  const forwardAbort = (): void => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) forwardAbort();
  else opts.signal?.addEventListener('abort', forwardAbort, { once: true });

  const stalled = (): void => giveUp(`stalled for ${stallTimeoutMs} ms`);
  let timer = setTimeout(stalled, stallTimeoutMs);

  /** What the body itself failed with: its own error, or its length. Kept
   * in an object because it is set inside the stream, where the compiler's
   * reading of this function does not follow. */
  const ofBody: { failure?: { error: unknown } } = {};
  const source = body.getReader();
  let released = false;
  let stored = false;
  /** Give the body back: a request's socket, a file's descriptor. A read
   * that is still out is answered as the body's end. */
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await source.cancel().catch((error: unknown) => {
      // A body that failed, or whose sender is gone, answers its cancel
      // with that failure, and the transfer reports it once, as its own.
      // Only a body that could not be given back after its object was
      // stored is news.
      if (stored) {
        console.warn(
          `[object-store] the body of S3 PUT ${key} could not be released:`,
          error,
        );
      }
    });
  };
  // One chunk is kept back, so that the one completing the object is sent
  // only when nothing follows it.
  let held: Uint8Array | null = null;
  let passed = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(sink) {
      try {
        for (;;) {
          const next = await source.read();
          if (next.done) {
            const total = passed + (held?.byteLength ?? 0);
            if (total !== contentLength) {
              throw new ObjectLengthMismatchError(
                key,
                contentLength,
                total < contentLength ? 'fewer' : 'more',
              );
            }
            if (held !== null) {
              opts.onChunk?.(held);
              sink.enqueue(held);
              passed = total;
              held = null;
            }
            clearTimeout(timer);
            timer = setTimeout(
              () =>
                giveUp(
                  `was not answered within ${answerTimeoutMs} ms of its last byte`,
                ),
              answerTimeoutMs,
            );
            sink.close();
            return;
          }
          const chunk = next.value;
          // A chunk with nothing in it says nothing about what follows, so
          // it must not be what lets the completing chunk go.
          if (chunk.byteLength === 0) continue;
          if (held === null) {
            held = chunk;
            continue;
          }
          if (passed + held.byteLength + chunk.byteLength > contentLength) {
            throw new ObjectLengthMismatchError(key, contentLength, 'more');
          }
          const out = held;
          held = chunk;
          passed += out.byteLength;
          opts.onChunk?.(out);
          clearTimeout(timer);
          timer = setTimeout(stalled, stallTimeoutMs);
          sink.enqueue(out);
          return;
        }
      } catch (error) {
        // Once the transfer is over, a read that was still out is answered
        // as the body's end: that is no failure of the body's.
        if (released) return;
        ofBody.failure = { error };
        sink.error(error);
      }
    },
    cancel: release,
  });

  try {
    const signed = await store.client.sign(objectUrl(store, key), {
      method: 'PUT',
      headers: {
        'content-type': opts.contentType,
        ...(opts.createOnly ? { 'if-none-match': '*' } : {}),
      },
    });
    const headers = new Headers(signed.headers);
    // Not part of the signature, and what makes this one PUT instead of a
    // chunked body no store takes.
    headers.set('content-length', String(contentLength));
    const res = await fetch(signed.url, {
      method: 'PUT',
      headers,
      body: stream,
      signal: controller.signal,
      // Load-bearing for memory: unless it is told that a redirect is an
      // error, `fetch` keeps a second copy of a body stream, to send it
      // again should the store redirect, and that copy holds every chunk
      // until the answer has come: the whole object, in this process. A
      // body that has been read could not be sent again in any case.
      redirect: 'error',
      // A body that is a stream is sent while the answer is still to come:
      // the runtime asks to be told so, and the typings do not know the
      // option yet.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
      ...({ duplex: 'half' } as unknown as RequestInit),
    });
    if (opts.createOnly && res.status === 412) {
      // The key is taken: the store kept what it has, and what was sent of
      // this body is nowhere.
      await res.body?.cancel();
      return 'exists';
    }
    if (!res.ok) {
      throw new Error(
        `S3 PUT ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
      );
    }
    await res.body?.cancel();
    stored = true;
    return 'created';
  } catch (error) {
    // Whatever ended the transfer, the store must not be left a connection
    // with half an object on it, nor the body its reader.
    controller.abort(error);
    await release();
    // A key that is taken may have been refused by a connection that
    // closed (see above). The body's own failure and a caller that gave up
    // are not that, and are told as they are.
    if (
      opts.createOnly === true &&
      ofBody.failure === undefined &&
      opts.signal?.aborted !== true &&
      (await isTaken(store, key))
    ) {
      return 'exists';
    }
    // The body's own failure says more than the "fetch failed" it caused;
    // otherwise the signal's reason says why the transfer ended: the
    // caller's, a body that stood still, an answer that never came.
    if (ofBody.failure !== undefined) throw ofBody.failure.error;
    throw controller.signal.aborted && controller.signal.reason !== error
      ? controller.signal.reason
      : error;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forwardAbort);
    await release();
  }
}

/** Whether the key holds an object, asked after a create-only PUT of it
 * failed. A store that cannot be asked leaves the failure as it was. */
async function isTaken(store: S3ObjectStore, key: string): Promise<boolean> {
  try {
    return (await s3HeadObject(store, key)) !== null;
  } catch (error) {
    console.warn(
      `[object-store] whether ${key} is taken could not be asked after its create-only PUT failed:`,
      error,
    );
    return false;
  }
}

/**
 * GET an object: its raw bytes plus the Content-Type the store holds for it
 * (`null` when the store answers none) — the pair a copy between stores needs
 * to land the object as it was. Throws on a non-2xx response, 404 included.
 */
export async function s3GetObject(
  store: S3ObjectStore,
  key: string,
  opts: S3ReadOpts = {},
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const got = await s3GetObjectIfExists(store, key, opts);
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
  opts: S3ReadOpts = {},
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  const res = await s3Fetch(
    store,
    key,
    'GET',
    {},
    opts.timeoutMs ?? S3_BODY_TIMEOUT_MS,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `S3 GET ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
  const contentType = res.headers.get('content-type');
  return {
    bytes:
      opts.maxBytes === undefined
        ? new Uint8Array(await res.arrayBuffer())
        : await readAtMost(res, key, opts.maxBytes),
    contentType:
      contentType === null || contentType === '' ? null : contentType,
  };
}

/** A response's body, read only as far as `maxBytes` allows. */
async function readAtMost(
  res: Response,
  key: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? Number.NaN);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new ObjectTooLargeError(key, maxBytes, declared);
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ObjectTooLargeError(key, maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** The bytes half of `s3GetObjectIfExists`: `null` on 404, thrown otherwise. */
export async function s3GetObjectBytesIfExists(
  store: S3ObjectStore,
  key: string,
  opts: S3ReadOpts = {},
): Promise<Uint8Array | null> {
  const got = await s3GetObjectIfExists(store, key, opts);
  return got === null ? null : got.bytes;
}

/** GET the raw bytes of an object. Throws on a non-2xx response. */
export async function s3GetObjectBytes(
  store: S3ObjectStore,
  key: string,
  opts: S3ReadOpts = {},
): Promise<Uint8Array> {
  return (await s3GetObject(store, key, opts)).bytes;
}

/** An object as it arrives: its bytes, and the Content-Type the store holds
 * for them (`null` when it answers none). */
export interface S3ObjectStream {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
}

/**
 * GET an object as a stream, for a caller that passes its bytes on: a copy
 * to another store reads no object whole (tale-project/tale#4942). `null`
 * when the store answers 404; a thrown error for everything else, as
 * {@link s3GetObject}.
 *
 * The caller reads the body to its end or cancels it. The headers must
 * arrive within the metadata bound; after that the body is bounded by
 * whoever reads it ({@link s3PutObjectStream} gives up on one that stands
 * still), and the caller's signal ends it at any time.
 */
export async function s3GetObjectStream(
  store: S3ObjectStore,
  key: string,
  opts: { signal?: AbortSignal; headerTimeoutMs?: number } = {},
): Promise<S3ObjectStream | null> {
  const headerTimeoutMs = opts.headerTimeoutMs ?? S3_METADATA_TIMEOUT_MS;
  const controller = new AbortController();
  // Left in place once the headers are in: the body still streams under the
  // caller's signal.
  const forwardAbort = (): void => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) forwardAbort();
  else opts.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`S3 GET ${key} timed out after ${headerTimeoutMs} ms`),
      ),
    headerTimeoutMs,
  );
  try {
    const res = await store.client.fetch(objectUrl(store, key), {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      throw new Error(
        `S3 GET ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
      );
    }
    const contentType = res.headers.get('content-type');
    return {
      body:
        res.body ??
        new ReadableStream<Uint8Array>({
          start(empty) {
            empty.close();
          },
        }),
      contentType:
        contentType === null || contentType === '' ? null : contentType,
    };
  } catch (error) {
    controller.abort(error);
    opts.signal?.removeEventListener('abort', forwardAbort);
    throw controller.signal.aborted && controller.signal.reason !== error
      ? controller.signal.reason
      : error;
  } finally {
    clearTimeout(timer);
  }
}

/** What a streamed GET wrote: how many bytes, and the Content-Type the
 * store holds for them (`null` when it answers none). */
export interface S3ObjectFile {
  size: number;
  contentType: string | null;
}

/** A GET met more bytes than its caller accepts. */
export class ObjectTooLargeError extends Error {
  readonly maxBytes: number;
  /** How many bytes the object holds, where the store declared it. */
  readonly size: number | null;

  constructor(key: string, maxBytes: number, size: number | null = null) {
    super(
      size === null
        ? `S3 GET ${key} holds more than the ${maxBytes} bytes accepted`
        : `S3 GET ${key} holds ${size} bytes, more than the ${maxBytes} accepted`,
    );
    this.name = 'ObjectTooLargeError';
    this.maxBytes = maxBytes;
    this.size = size;
  }
}

export interface S3GetToFileOpts {
  /** Ends the transfer when the caller gives up; its reason is rethrown. */
  signal?: AbortSignal;
  /** The most bytes to accept. One more ends the transfer with
   * {@link ObjectTooLargeError}. */
  maxBytes?: number;
  /** Sees every chunk, in order, as it is written: a hash of the object. */
  onChunk?: (chunk: Uint8Array) => void;
  /** How long the store may take to answer its headers. */
  headerTimeoutMs?: number;
  /** How long the body may stand still before the transfer is given up. */
  stallTimeoutMs?: number;
}

/**
 * GET an object into a file, as its bytes arrive. The object is never held
 * whole in memory, so a process reads one larger than the memory it has left
 * (tale-project/tale#4942): the heavy slot hands the file to its child
 * process, and a recording goes to ffmpeg from the disk.
 *
 * `null` when the store answers 404; a thrown error for everything else, as
 * {@link s3GetObject}. The file is created here and must not exist; one left
 * half-written by a failure is removed.
 *
 * Bounded by progress, not by a total: the headers must arrive within the
 * metadata bound, and the body may then take as long as it keeps moving. A
 * total would cut a large object on a slow link mid-stream, and no total
 * fits both a note and a recording of several hundred megabytes.
 */
export async function s3GetObjectToFile(
  store: S3ObjectStore,
  key: string,
  filePath: string,
  opts: S3GetToFileOpts = {},
): Promise<S3ObjectFile | null> {
  let file: FileHandle | undefined;
  return await readObject(store, key, opts, {
    open: async () => {
      // `wx`: a path that exists is somebody else's file, never overwritten.
      file = await open(filePath, 'wx', 0o600);
    },
    // The whole chunk, from where the last one ended.
    write: async (chunk) => {
      await file?.writeFile(chunk);
    },
    close: async () => {
      await file?.close();
    },
    discard: async () => {
      await rm(filePath, { force: true }).catch((cause: unknown) => {
        console.warn(
          `[object-store] a half-written ${filePath} could not be removed:`,
          cause,
        );
      });
    },
  });
}

/**
 * The SHA-256 of a stored object, and how long the object is. It is read as
 * it arrives and none of it is kept, so a process can check an object larger
 * than the memory it has left against what it meant to store
 * (tale-project/tale#4942).
 *
 * `null` when the store answers 404; a thrown error for everything else.
 * Bounded as {@link s3GetObjectToFile} is.
 */
export async function s3ObjectSha256(
  store: S3ObjectStore,
  key: string,
  opts: Omit<S3GetToFileOpts, 'onChunk'> = {},
): Promise<{ sha256: string; size: number } | null> {
  const hash = createHash('sha256');
  const read = await readObject(
    store,
    key,
    {
      ...opts,
      onChunk: (chunk) => {
        hash.update(chunk);
      },
    },
    {},
  );
  return read === null ? null : { sha256: hash.digest('hex'), size: read.size };
}

/** Where an object's chunks go as they arrive. A reader that only looks at
 * them (`onChunk`) names no part, and keeps nothing. */
interface ObjectSink {
  /** Once the store has answered that it has the object, before the
   * object's first chunk. */
  open?(): Promise<void>;
  /** One chunk. The next is read only once this has returned. */
  write?(chunk: Uint8Array): Promise<void>;
  /** When the chunks have ended, or the transfer has: for a sink that was
   * opened. */
  close?(): Promise<void>;
  /** After `close`, for a transfer that did not reach the object's end:
   * what was written is not the object. */
  discard?(): Promise<void>;
}

/** GET an object and pass its chunks to `sink` as they arrive: the one
 * transfer under {@link s3GetObjectToFile} and {@link s3ObjectSha256}. */
async function readObject(
  store: S3ObjectStore,
  key: string,
  opts: S3GetToFileOpts,
  sink: ObjectSink,
): Promise<S3ObjectFile | null> {
  const headerTimeoutMs = opts.headerTimeoutMs ?? S3_METADATA_TIMEOUT_MS;
  const stallTimeoutMs = opts.stallTimeoutMs ?? S3_BODY_TIMEOUT_MS;
  const controller = new AbortController();
  const giveUp = (why: string): void =>
    controller.abort(new Error(`S3 GET ${key} ${why}`));
  const forwardAbort = (): void => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) forwardAbort();
  else opts.signal?.addEventListener('abort', forwardAbort, { once: true });

  let timer = setTimeout(
    () => giveUp(`timed out after ${headerTimeoutMs} ms`),
    headerTimeoutMs,
  );
  let opened = false;
  try {
    const res = await store.client.fetch(objectUrl(store, key), {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      throw new Error(
        `S3 GET ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
      );
    }
    const contentType = res.headers.get('content-type');
    await sink.open?.();
    opened = true;
    let size = 0;
    try {
      if (res.body !== null) {
        for await (const chunk of res.body) {
          clearTimeout(timer);
          size += chunk.byteLength;
          if (opts.maxBytes !== undefined && size > opts.maxBytes) {
            throw new ObjectTooLargeError(key, opts.maxBytes);
          }
          opts.onChunk?.(chunk);
          await sink.write?.(chunk);
          timer = setTimeout(
            () => giveUp(`stalled for ${stallTimeoutMs} ms`),
            stallTimeoutMs,
          );
        }
      }
    } finally {
      await sink.close?.();
    }
    return {
      size,
      contentType:
        contentType === null || contentType === '' ? null : contentType,
    };
  } catch (error) {
    // Give the connection back whatever ended the transfer: a body left
    // unread would hold its socket until the store closed it.
    controller.abort(error);
    if (opened) await sink.discard?.();
    // The signal's own reason says why the transfer ended: the caller's, a
    // header that never came, a body that stood still.
    throw controller.signal.aborted && controller.signal.reason !== error
      ? controller.signal.reason
      : error;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forwardAbort);
  }
}

/** What a HEAD says about a stored object: its authoritative size, the
 * Content-Type the store holds for it, and the validators it issues — the
 * `ETag` and `Last-Modified` a GET of the same object carries, so a door
 * that answers a HEAD or judges a `Range` locally can speak them without
 * fetching a byte (`null` when the store answers none). */
export interface S3ObjectHead {
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
}

/**
 * HEAD an object → its size in bytes (the authoritative server-side length),
 * stored Content-Type, and the `ETag` / `Last-Modified` validators. The size
 * verifies an `s3:` upload's real size against the product cap — a presigned
 * PUT enforces no Content-Length, so the client-declared size can't be
 * trusted; the type lets a copy between stores be recognised as the SAME
 * object rather than a same-length one; the validators let the REST file
 * lane answer a HEAD, and judge a `Range` against the size, without a GET.
 * Returns `null` when the object is missing (404).
 */
export async function s3HeadObject(
  store: S3ObjectStore,
  key: string,
  opts: S3TimeoutOpts = {},
): Promise<S3ObjectHead | null> {
  const res = await s3Fetch(
    store,
    key,
    'HEAD',
    {},
    opts.timeoutMs ?? S3_METADATA_TIMEOUT_MS,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`S3 HEAD ${key} failed: ${res.status}`);
  }
  const len = res.headers.get('content-length');
  const size = len === null ? NaN : Number(len);
  if (!Number.isFinite(size)) {
    throw new Error(`S3 HEAD ${key} returned no usable content-length`);
  }
  const contentType = res.headers.get('content-type');
  const blankToNull = (value: string | null): string | null =>
    value === null || value === '' ? null : value;
  return {
    size,
    contentType: blankToNull(contentType),
    etag: blankToNull(res.headers.get('etag')),
    lastModified: blankToNull(res.headers.get('last-modified')),
  };
}

/** DELETE an object. S3 DELETE is idempotent (204 whether or not it existed). */
export async function s3DeleteObject(
  store: S3ObjectStore,
  key: string,
  opts: S3TimeoutOpts = {},
): Promise<void> {
  const res = await s3Fetch(
    store,
    key,
    'DELETE',
    {},
    opts.timeoutMs ?? S3_METADATA_TIMEOUT_MS,
  );
  // 204 (deleted) and 404 (already gone) are both success for our purposes.
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `S3 DELETE ${key} failed: ${res.status} ${await safeErrorBody(res)}`,
    );
  }
}

/** Default presigned-URL lifetime (seconds) — long enough for a browser fetch.
 * The app renews the links it keeps before they run out, from the same value
 * (`lib/shared/constants/file-links.ts`). */
const DEFAULT_PRESIGN_TTL_SEC = FILE_LINK_LIFETIME_SEC;

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
  // The store reflects this param as a response header: the RFC 6266 form
  // (an ASCII `filename` plus the exact name as `filename*`), built by the
  // one builder every download lane shares — control characters can never
  // splice into the header, and a non-ASCII name no longer arrives as
  // mojibake.
  url.searchParams.set(
    'response-content-disposition',
    opts.filename === undefined
      ? 'attachment'
      : attachmentDisposition(opts.filename),
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
