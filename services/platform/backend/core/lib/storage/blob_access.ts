'use node';

/**
 * Org-blob access — the single seam every org-owned blob operation routes
 * through. Blobs live in S3-compatible storage only (the org's own bucket,
 * else the deployment default's — see `object_store.ts`, which fails closed
 * when neither is configured); the Convex `_storage` backend the 0.4 runtime
 * used is retired, and no 0.5 ctx can read, serve or delete a `_storage` id.
 *
 * # The blob reference
 *
 * A stored reference is a STRING: `s3:<objectKey>` for a blob in the org's
 * bucket (`blob_ref.ts` owns the encoding). Any other string is a legacy
 * `_storage` id from before the cutover, and every reader here refuses it
 * with a typed {@link UnsupportedBlobRefError} — a caller sees "this ref
 * cannot be served" instead of a shim `TypeError` from deep inside a lane.
 *
 * Every S3 read / delete is namespace-guarded (`requireS3`): a blob ref is a
 * client-bindable string, so a key outside the org's own namespace is refused
 * outright, never resolved against a shared bucket.
 */

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
  s3PutObject,
  type S3ObjectStore,
} from './object_store';

export type { BlobRef } from './blob_ref';
export { encodeS3Ref, parseBlobRef, isS3Ref } from './blob_ref';

/** A blob reference this deployment cannot resolve: anything but an `s3:`
 * ref — the retired Convex `_storage` lane, or a malformed string bound by a
 * client. Typed so a caller can tell "unsupported ref" from an S3 failure. */
export class UnsupportedBlobRefError extends Error {
  constructor(ref: BlobRef) {
    super(
      `blob ref "${ref}" is not an s3: reference — the Convex _storage backend is retired and cannot be read`,
    );
    this.name = 'UnsupportedBlobRefError';
  }
}

/**
 * Store bytes for an org and return the stored reference — always an `s3:`
 * ref into the org's resolved bucket; an unconfigured store throws at this
 * door instead of failing deeper in the lane.
 */
export async function putBlob(
  orgSlug: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<BlobRef> {
  const store = await resolveOrgObjectStore(orgSlug);
  const key = buildObjectKey(store, orgSlug);
  await s3PutObject(store, key, bytes, contentType);
  return encodeS3Ref(key);
}

/** Read a blob's raw bytes from the org's store. Throws
 * {@link UnsupportedBlobRefError} for a non-`s3:` ref. */
export async function readBlobBytes(
  orgSlug: string,
  ref: BlobRef,
): Promise<Uint8Array> {
  const key = requireS3Key(ref);
  const store = await requireS3(orgSlug, key);
  return await s3GetObjectBytes(store, key);
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

/** Delete a blob from the org's store. Idempotent (S3 DELETE answers 204
 * whether or not the object existed). Throws {@link UnsupportedBlobRefError}
 * for a non-`s3:` ref. */
export async function deleteBlob(orgSlug: string, ref: BlobRef): Promise<void> {
  const key = requireS3Key(ref);
  const store = await requireS3(orgSlug, key);
  await s3DeleteObject(store, key);
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

/** The S3 object key of `ref`, or a typed refusal for any other reference. */
function requireS3Key(ref: BlobRef): string {
  const parsed = parseBlobRef(ref);
  if (parsed.backend !== 's3') throw new UnsupportedBlobRefError(ref);
  return parsed.key;
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
