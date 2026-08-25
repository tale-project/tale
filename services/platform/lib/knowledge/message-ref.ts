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

/** Encode a `conversationMessages` id as a corpus ref. */
export function encodeMessageRef(messageId: string): string {
  return `${MESSAGE_REF_PREFIX}${messageId}`;
}

/** True when a corpus ref names a message rather than a blob. */
export function isMessageRef(ref: string): boolean {
  return ref.startsWith(MESSAGE_REF_PREFIX);
}

/**
 * The message id inside a corpus ref, or null when the ref names something
 * else. An empty id reads as null, so `msg:` alone is not a valid ref.
 */
export function parseMessageRef(ref: string): string | null {
  if (!isMessageRef(ref)) return null;
  const id = ref.slice(MESSAGE_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}
