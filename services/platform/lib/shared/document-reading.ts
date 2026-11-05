/**
 * How far the assistant can read a document someone attached — the rules the
 * server's send gate (`domains/chat/deferred-sends.ts`), the composer and the
 * turn's attachment list all apply, kept in one place so the three can never
 * disagree about whether a message waits.
 *
 * An attachment is read on a worker right after its upload
 * (`domains/knowledge/read-text.ts`): the indexer's own extractors, then the
 * organization's secret scan and PII policy. The read's outcome is the file's
 * `text_status`; its index (`rag_status`) is built after it, and only a
 * document too large to read before its index waits for the index.
 *
 * Dependency-free: the client imports it too.
 */

/** Where a document's read stands (`app.file_metadata.text_status`). */
export const DOCUMENT_TEXT_STATUSES = [
  'queued',
  'running',
  'ready',
  'refused',
  'unreadable',
  'deferred',
] as const;

export type DocumentTextStatus = (typeof DOCUMENT_TEXT_STATUSES)[number];

/** Why a read left the document to its index (`text_error_code` of a
 * `deferred` read): over the byte cap of a read, more text than a read
 * keeps, or a read that failed on the platform's side. */
export const TEXT_TOO_LARGE = 'too_large';
export const TEXT_TOO_MUCH = 'too_much_text';
export const TEXT_READ_FAILED = 'read_failed';

/** The read has decided: the text is ready, or the organization's checks
 * refused it, or the file holds none. */
function textDecided(status: string | null | undefined): boolean {
  return status === 'ready' || status === 'refused' || status === 'unreadable';
}

/**
 * Whether a message that carries this document waits for it.
 *
 * A decided read never holds a message: the assistant reads the checked
 * text, or is told that it may not or cannot. Otherwise the message waits
 * while the document's index is queued or running — which covers a read
 * still to come (the upload marks its index queued, and the read hands the
 * index on), a read that left the document to its index, and a file from
 * before reads existed. A file nothing reads or indexes holds nothing.
 */
export function documentHoldsSend(file: {
  readonly textStatus?: string | null;
  readonly ragStatus?: string | null;
}): boolean {
  if (textDecided(file.textStatus)) return false;
  return file.ragStatus === 'queued' || file.ragStatus === 'running';
}
