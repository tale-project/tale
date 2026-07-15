/**
 * Pure blob-reference encoding — V8-safe (NO `node:*`, NO `fetch`), so Convex
 * schema files, queries, and mutations can import the validator + parser. The
 * actual S3 I/O lives in the `'use node'` sibling `blob_access.ts`.
 *
 * A stored blob reference is a STRING that is EITHER a Convex `_storage` id
 * (unchanged — the deployment default) OR `s3:<objectKey>` (the bytes live in
 * the org's own bucket). This is the ONLY module that knows the encoding.
 */

import { v, type GenericId } from 'convex/values';

// Use `GenericId` from `convex/values` — NOT `Id` from `_generated/dataModel`.
// This module's `blobRefValidator` is imported BY the schema (documents /
// fileMetadata), and `dataModel`'s `Id` is derived FROM the schema, so importing
// `Id` here would close a schema↔dataModel type cycle that poisons every
// query/mutation ctx type (TS2719). `GenericId<'_storage'>` is identical to
// `Id<'_storage'>` but schema-independent.
type StorageId = GenericId<'_storage'>;

/** A stored blob reference: a Convex `_storage` id, or an `s3:`-prefixed key. */
export type BlobRef = StorageId | string;

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
  | { backend: 'convex'; storageId: StorageId }
  | { backend: 's3'; key: string };

/**
 * Decode a stored reference. An `s3:`-prefixed string is an S3 key; anything
 * else is a Convex storage id (Convex ids never contain a `:`).
 */
export function parseBlobRef(ref: BlobRef): ParsedBlobRef {
  if (typeof ref === 'string' && ref.startsWith(S3_PREFIX)) {
    return { backend: 's3', key: ref.slice(S3_PREFIX.length) };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a non-`s3:` ref is a Convex `_storage` id by construction
  return { backend: 'convex', storageId: ref as StorageId };
}

/** True when a stored reference points at the org's S3 bucket (not `_storage`). */
export function isS3Ref(ref: BlobRef): boolean {
  return typeof ref === 'string' && ref.startsWith(S3_PREFIX);
}

/** The Convex storage id of a convex-backed ref, or null for an S3 ref. */
export function convexStorageId(ref: BlobRef): StorageId | null {
  const parsed = parseBlobRef(ref);
  return parsed.backend === 'convex' ? parsed.storageId : null;
}
