/**
 * Pure blob-reference encoding — V8-safe (NO `node:*`, NO `fetch`), so any
 * module can import the parser. The actual S3 I/O lives in the `blob_access.ts`
 * sibling.
 *
 * A stored blob reference is a STRING that is EITHER a legacy `_storage` id
 * (the retired Convex deployment default) OR `s3:<objectKey>` (the bytes live
 * in the org's own bucket). This is the ONLY module that knows the encoding.
 */

/** A stored blob reference: a legacy `_storage` id, or an `s3:`-prefixed key. */
export type BlobRef = string;

const S3_PREFIX = 's3:';

/** Encode an S3 object key as a stored blob reference. */
export function encodeS3Ref(key: string): string {
  return `${S3_PREFIX}${key}`;
}

export type ParsedBlobRef =
  | { backend: 'convex'; storageId: string }
  | { backend: 's3'; key: string };

/**
 * Decode a stored reference. An `s3:`-prefixed string is an S3 key; anything
 * else is a legacy `_storage` id (those ids never contain a `:`).
 */
export function parseBlobRef(ref: BlobRef): ParsedBlobRef {
  if (ref.startsWith(S3_PREFIX)) {
    return { backend: 's3', key: ref.slice(S3_PREFIX.length) };
  }
  return { backend: 'convex', storageId: ref };
}

/** True when a stored reference points at the org's S3 bucket (not `_storage`). */
export function isS3Ref(ref: BlobRef): boolean {
  return ref.startsWith(S3_PREFIX);
}

/** The legacy storage id of a convex-backed ref, or null for an S3 ref. */
export function convexStorageId(ref: BlobRef): string | null {
  const parsed = parseBlobRef(ref);
  return parsed.backend === 'convex' ? parsed.storageId : null;
}

/**
 * TENANT ISOLATION — does an S3 object key sit in `orgSlug`'s own namespace?
 *
 * `buildObjectKey` always mints `[<prefix>/]<orgSlug>/<uuid>`, so the
 * second-to-last segment IS the owning org, regardless of the org-chosen
 * `prefix` (and of later prefix changes — old keys still carry the slug).
 * Blob refs are client-bindable strings, so every S3 read / presign / delete
 * MUST refuse a key outside the org's namespace — otherwise two orgs sharing
 * one physical bucket (a supported config; `prefix` exists for exactly that)
 * could address each other's objects by binding a foreign key. Empty segments
 * are rejected outright (`a//b` never comes out of `buildObjectKey`).
 */
export function s3KeyBelongsToOrg(key: string, orgSlug: string): boolean {
  const segments = key.split('/');
  if (segments.length < 2 || segments.some((s) => s.length === 0)) {
    return false;
  }
  return segments[segments.length - 2] === orgSlug;
}
