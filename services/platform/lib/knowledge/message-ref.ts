/**
 * Corpus refs for an email MESSAGE, as distinct from a blob.
 *
 * Every other corpus ref names bytes: a Convex `_storage` id, or an `s3:` key
 * (`convex/lib/storage/blob_ref.ts`). A message has no bytes of its own — its
 * text is a column on the row — so it needs a ref that a blob path can never
 * mistake for one of its own.
 *
 * Deliberately NOT part of `BlobRef`. `parseBlobRef` treats any string without
 * an `s3:` prefix as a Convex storage id rather than rejecting it, so a `msg:`
 * ref reaching a blob read or delete would be coerced instead of refused. That
 * is safe only while no Convex row carries one: every `parseBlobRef` caller
 * takes its ref from `documents.fileId`, `documents.historyFiles`, or
 * `fileMetadata.storageId`, and a message has none of those rows.
 *
 * If a message ever gains a `documents` or `fileMetadata` row, that reasoning
 * expires — add a `msg:` arm to `ParsedBlobRef` so the compiler forces every
 * blob caller to handle it.
 */

const MESSAGE_REF_PREFIX = 'msg:';

/** True when a corpus ref names a message rather than a blob — the one
 * question the retrievable filter and the ref release ask of a ref today;
 * nothing writes such a ref yet, so there is no encoder or parser until
 * something does. */
export function isMessageRef(ref: string): boolean {
  return ref.startsWith(MESSAGE_REF_PREFIX);
}
