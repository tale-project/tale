/**
 * Corpus refs for an email MESSAGE, as distinct from a blob.
 *
 * Every other corpus ref names bytes: a Convex `_storage` id, or an `s3:` key
 * (`convex/lib/storage/blob_ref.ts`). A message has no bytes of its own — its
 * text is a column on the row — so it needs a ref that a blob path can never
 * mistake for one of its own: `msg:<message id>`, the id of its
 * `app.conversation_messages` row.
 *
 * Deliberately NOT part of `BlobRef`. `parseBlobRef` treats any string without
 * an `s3:` prefix as a Convex storage id rather than rejecting it, so a `msg:`
 * ref reaching a blob read or delete would be coerced instead of refused. That
 * is safe only while no Convex row carries one: every `parseBlobRef` caller
 * takes its ref from `documents.fileId`, `documents.historyFiles`, or
 * `fileMetadata.storageId`, and a message has none of those rows. The release
 * seam (`domains/knowledge/release.ts`) splits message refs off before its blob
 * stage for the same reason.
 *
 * If a message ever gains a `documents` or `fileMetadata` row, that reasoning
 * expires — add a `msg:` arm to `ParsedBlobRef` so the compiler forces every
 * blob caller to handle it.
 */

const MESSAGE_REF_PREFIX = 'msg:';

/** A `LIKE` pattern matching every message ref. The prefix holds no `LIKE`
 * metacharacter (`%`, `_`, `\`), so it is used verbatim. */
export const MESSAGE_REF_LIKE_PATTERN = `${MESSAGE_REF_PREFIX}%`;

/**
 * What a message id looks like: `gen_random_uuid()` text for every row the
 * conversation tables mint, and never anything but letters, digits, `-` and
 * `_`. A ref is external input — a model quotes one back to `rag_fetch` — so
 * the parser refuses anything else rather than handing it to a query.
 */
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** True when a corpus ref names a message rather than a blob — asked by the
 * retrievable filter, the ref release and the corpus reconcile before any of
 * them treats a ref as bytes. A malformed `msg:` ref is still a message ref:
 * it names no message, and must never fall through to a blob path. */
export function isMessageRef(ref: string): boolean {
  return ref.startsWith(MESSAGE_REF_PREFIX);
}

/** Whether a message row's id can carry a ref at all — asked by a lane that
 * reads ids off rows in bulk, so one odd id is skipped rather than failing
 * the rest (the indexer never writes a ref for it either). */
export function isMessageId(messageId: string): boolean {
  return MESSAGE_ID.test(messageId);
}

/** The corpus ref of one message. Throws on an id no message row carries —
 * that is a caller bug, never a value to index under. */
export function messageRef(messageId: string): string {
  if (!isMessageId(messageId)) {
    throw new Error(
      `Not a conversation message id: ${JSON.stringify(messageId)}`,
    );
  }
  return `${MESSAGE_REF_PREFIX}${messageId}`;
}

/** The message id a ref names, or null when the ref is not a message ref or
 * names no well-formed id. */
export function parseMessageRef(ref: string): string | null {
  if (!isMessageRef(ref)) return null;
  const messageId = ref.slice(MESSAGE_REF_PREFIX.length);
  return isMessageId(messageId) ? messageId : null;
}

/**
 * Which messages the corpus holds: email that ARRIVED. The covering note is
 * what explains an attachment — the role an applicant names, the order a
 * complaint is about — and that is the text no retrieval leg could reach.
 *
 * Our own replies stay out. They are mostly acknowledgement written from what
 * came in, so they would add noise to every answer, and they are a member's
 * words: the member erasure lane (`domains/erasure/service.ts`) reaches no
 * conversation, so it could not take them back out. A conversation mirrored
 * over the API (`channel: 'api'`) is another system's record and stays out
 * too.
 *
 * The ingest enqueue, the indexer, the retrievable filter and the ref release
 * all read these two values — the SQL halves bind them as parameters — so the
 * lanes cannot disagree about which rows a message ref may name.
 */
export const INDEXED_MESSAGE_DIRECTION = 'inbound';
export const INDEXED_MESSAGE_CHANNEL = 'email';

export function isIndexedMessage(message: {
  readonly direction: string;
  readonly channel: string | null;
}): boolean {
  return (
    message.direction === INDEXED_MESSAGE_DIRECTION &&
    message.channel === INDEXED_MESSAGE_CHANNEL
  );
}
