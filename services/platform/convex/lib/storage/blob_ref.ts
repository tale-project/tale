/**
 * Pure blob-reference encoding — V8-safe (NO `node:*`, NO `fetch`), so Convex
 * schema files, queries, and mutations can import the validator + parser. The
 * actual S3 I/O lives in the `'use node'` sibling `blob_access.ts`.
 *
 * A stored blob reference is a STRING that is EITHER a Convex `_storage` id
 * (unchanged — the deployment default) OR `s3:<objectKey>` (the bytes live in
 * the org's own bucket). This is the ONLY module that knows the encoding.
 */

import { v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';

/** A stored blob reference: a Convex `_storage` id, or an `s3:`-prefixed key. */
export type BlobRef = Id<'_storage'> | string;

const S3_PREFIX = 's3:';

/**
 * Schema validator for a blob-reference field. Widening a legacy
 * `v.id('_storage')` field to this union is backward-compatible — every
 * existing id value still validates, and new S3 refs land in the string arm.
 */
export const blobRefValidator = v.union(v.id('_storage'), v.string());

/** Encode an S3 object key as a stored blob reference. */
export function encodeS3Ref(key: string): string {
  return `${S3_PREFIX}${key}`;
}

export type ParsedBlobRef =
  | { backend: 'convex'; storageId: Id<'_storage'> }
  | { backend: 's3'; key: string };

/**
 * Decode a stored reference. An `s3:`-prefixed string is an S3 key; anything
 * else is a Convex storage id (Convex ids never contain a `:`).
 */
export function parseBlobRef(ref: BlobRef): ParsedBlobRef {
  if (typeof ref === 'string' && ref.startsWith(S3_PREFIX)) {
    return { backend: 's3', key: ref.slice(S3_PREFIX.length) };
  }
  return { backend: 'convex', storageId: ref as Id<'_storage'> };
}

/** True when a stored reference points at the org's S3 bucket (not `_storage`). */
export function isS3Ref(ref: BlobRef): boolean {
  return typeof ref === 'string' && ref.startsWith(S3_PREFIX);
}

/** The Convex storage id of a convex-backed ref, or null for an S3 ref. */
export function convexStorageId(ref: BlobRef): Id<'_storage'> | null {
  const parsed = parseBlobRef(ref);
  return parsed.backend === 'convex' ? parsed.storageId : null;
}
