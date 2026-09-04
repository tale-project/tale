'use node';

/**
 * Backend-aware blob access — the single seam every org-owned blob operation
 * routes through. New blobs always land in S3-compatible storage (the org's own
 * bucket, else the deployment default's — see `object_store.ts`, which fails
 * closed when neither is configured); the Convex-id branches below only read,
 * serve, or delete a LEGACY reference that predates the cutover.
 *
 * # The blob reference
 *
 * Historically every blob is an `Id<'_storage'>`. To let a blob live in S3
 * without a repo-wide id-type rewrite, a stored reference is now a STRING that
 * is EITHER:
 *   - a Convex storage id (unchanged — the default), or
 *   - `s3:<objectKey>` — the bytes live in the org's bucket at `<objectKey>`.
 * Schema fields widen from `v.id('_storage')` to `blobRefValidator`
 * (`v.union(v.id('_storage'), v.string())`); existing id values keep validating.
 * `parseBlobRef` / `encodeS3Ref` are the ONLY places that know the encoding.
 *
 * # Why an action context
 *
 * S3 verbs sign requests (crypto) and read per-org config (fs) — both need the
 * `'use node'` runtime, so put/read/delete for an S3-backed org run in ACTIONS.
 * Convex-backed blobs work in any ctx. Serving is the one asymmetry: a Convex
 * query CAN mint a `_storage` URL but CANNOT presign S3, so S3 blobs are served
 * through the node `/storage` HTTP route (see `blobServeThroughHttp`).
 */

import type { ActionCtx } from '../ctx';
import {
  encodeS3Ref,
  parseBlobRef,
  s3KeyBelongsToOrg,
  type BlobRef,
} from './blob_ref';
import {
  buildObjectKey,
  resolveOrgObjectStore,
  s3DeleteObject,
  s3GetObjectBytes,
  s3HeadObject,
  s3PresignGetUrl,
  s3PutObject,
  type S3ObjectStore,
} from './object_store';

export type { BlobRef } from './blob_ref';
export { encodeS3Ref, parseBlobRef, isS3Ref } from './blob_ref';

/**
 * Store bytes for an org and return the stored reference — always an `s3:`
 * ref into the org's resolved bucket; an unconfigured store throws at this
 * door instead of failing deeper in the lane. The `ctx` parameter is kept for
 * the reused 0.4 call shape.
 */
export async function putBlob(
  _ctx: ActionCtx,
  orgSlug: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<BlobRef> {
  const store = await resolveOrgObjectStore(orgSlug);
  const key = buildObjectKey(store, orgSlug);
  await s3PutObject(store, key, bytes, contentType);
  return encodeS3Ref(key);
}

/** Read a blob's raw bytes, from whichever backend owns it. Action ctx. */
export async function readBlobBytes(
  ctx: ActionCtx,
  orgSlug: string,
  ref: BlobRef,
): Promise<Uint8Array> {
  const parsed = parseBlobRef(ref);
  if (parsed.backend === 'convex') {
    const blob = await ctx.storage.get(parsed.storageId);
    if (blob === null) {
      throw new Error(`blob not found in _storage: ${parsed.storageId}`);
    }
    return new Uint8Array(await blob.arrayBuffer());
  }
  const store = await requireS3(orgSlug, parsed.key);
  return await s3GetObjectBytes(store, parsed.key);
}

/**
 * The authoritative byte size of an S3-backed blob (a server HEAD), or `null`
 * for a Convex ref (its size is authoritative at bind time via the `_storage`
 * system row) or a missing object. Namespace-guarded via `requireS3`, so an
 * org can only probe keys in its own namespace. Used to verify an `s3:` upload
 * against the product cap — a presigned PUT enforces no Content-Length.
 */
export async function s3BlobSize(
  orgSlug: string,
  ref: BlobRef,
): Promise<number | null> {
  const parsed = parseBlobRef(ref);
  if (parsed.backend !== 's3') return null;
  const store = await requireS3(orgSlug, parsed.key);
  const head = await s3HeadObject(store, parsed.key);
  return head?.size ?? null;
}

/**
 * Delete a blob from whichever backend owns it. Idempotent. Action ctx (S3
 * delete needs node; Convex `_storage.delete` is also available in mutations,
 * but a mixed-backend caller must schedule this from an action).
 */
export async function deleteBlob(
  ctx: ActionCtx,
  orgSlug: string,
  ref: BlobRef,
): Promise<void> {
  const parsed = parseBlobRef(ref);
  if (parsed.backend === 'convex') {
    await ctx.storage.delete(parsed.storageId);
    return;
  }
  const store = await requireS3(orgSlug, parsed.key);
  await s3DeleteObject(store, parsed.key);
}

/**
 * A time-limited download URL for a blob. Convex blobs get a `_storage` URL; S3
 * blobs get a presigned GET. Action ctx (S3 presign needs node) — the query
 * serve path uses `blobServeThroughHttp` instead.
 */
export async function getBlobUrl(
  ctx: ActionCtx,
  orgSlug: string,
  ref: BlobRef,
  opts: { filename?: string } = {},
): Promise<string | null> {
  const parsed = parseBlobRef(ref);
  if (parsed.backend === 'convex') {
    return await ctx.storage.getUrl(parsed.storageId);
  }
  const store = await requireS3(orgSlug, parsed.key);
  return await s3PresignGetUrl(store, parsed.key, { filename: opts.filename });
}

/**
 * Write attested bytes to a reserved S3 final reference exactly once.
 *
 * The final key is never returned with a write capability. `exists` supports
 * recovery when an action wrote the object and died before recording promotion.
 */
export async function putImmutableS3Blob(
  orgSlug: string,
  ref: BlobRef,
  bytes: Uint8Array,
  contentType: string,
): Promise<'created' | 'exists'> {
  const parsed = parseBlobRef(ref);
  if (parsed.backend !== 's3') {
    throw new Error('immutable S3 promotion requires an s3: reference');
  }
  const store = await requireS3(orgSlug, parsed.key);
  return await s3PutObject(store, parsed.key, bytes, contentType, {
    createOnly: true,
  });
}

/**
 * Resolve the org's S3 store for an operation on `key`, refusing a key outside
 * the org's own namespace. Blob refs are client-bindable strings, so without
 * this check a member of org A could bind org B's key and have A's read /
 * serve / delete address B's object whenever the two orgs resolve to the same
 * physical bucket (a supported config — `prefix` exists to share buckets).
 * Fail-closed: a foreign or malformed key throws, it is never "not found".
 */
async function requireS3(orgSlug: string, key: string): Promise<S3ObjectStore> {
  if (!s3KeyBelongsToOrg(key, orgSlug)) {
    throw new Error(
      `s3 blob key is outside org '${orgSlug}' namespace; refusing`,
    );
  }
  return resolveOrgObjectStore(orgSlug);
}
