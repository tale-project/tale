/**
 * Stable machine-readable causes for `fileMetadata.ragError`, persisted next to
 * the prose so surfaces can attach guidance (deep links, role-aware hints)
 * without sniffing English message text that is free to change — and so an
 * API poller can branch on `indexing.errorCode` ("retry", "tell the user to
 * re-export", "give up") instead of on a sentence the contract says never to
 * parse (2026-09-14 evaluation, g3-1).
 *
 * Deliberately dependency-free: the client imports these literals too (the
 * failed-indexing dialog), and the modules that raise the errors are
 * `'use node'` server code it must never pull in.
 *
 * Two families. A TERMINAL code lands the file on `unsupported`: the platform
 * cannot index these bytes and a retry reproduces the answer — the retry door
 * refuses it as `unsupported` instead of re-queueing billable work. Every
 * other code lands on `failed`: the job retries the transient ones by itself
 * and an admin lifts the rest.
 */

/** The organization has no embedding model configured (`EmbeddingNotConfigured`)
 * — fixed under Settings → Data residency → Embedding model. */
export const RAG_ERROR_EMBEDDING_NOT_CONFIGURED = 'embedding_not_configured';

/** The corpus's BM25 search index was found corrupted and is being rebuilt in
 * the background (`KnowledgeIndexUnavailable`); indexing resumes by itself —
 * every file refused with this code is re-queued when the rebuild verifies. */
export const RAG_ERROR_INDEX_REBUILDING = 'index_rebuilding';

/** The corpus's BM25 search index is corrupted and its automatic rebuild did
 * not restore it (`KnowledgeIndexUnavailable`); an operator has to repair the
 * index or restore the knowledge database, then indexing can be retried. */
export const RAG_ERROR_INDEX_REPAIR_FAILED = 'index_repair_failed';

/** The embedding provider refused the ACCOUNT or the credential — balance
 * spent, a plan that excludes the model, a rejected key, no access to the
 * model. Nothing here heals by waiting, so the indexing job does not retry:
 * an admin fixes the provider account or settings, then retries indexing. */
export const RAG_ERROR_EMBEDDING_PROVIDER_REFUSED =
  'embedding_provider_refused';

/** The embedding provider was unreachable, rate-limited or answered 5xx —
 * transient; the job retries by itself. */
export const RAG_ERROR_EMBEDDING_UPSTREAM = 'embedding_upstream';

/** Terminal: no text extractor exists for this file type. */
export const RAG_ERROR_UNSUPPORTED_TYPE = 'unsupported_type';

/** Terminal: an image, and no vision (OCR) lane is available to read it. */
export const RAG_ERROR_IMAGE_NO_VISION = 'image_no_vision';

/** Terminal: the extractor found no text — an empty file, whitespace alone,
 * a scanned PDF with no text layer. */
export const RAG_ERROR_EMPTY = 'empty';

/** Terminal: the bytes are not readable text (binary data behind a text
 * extension); re-export the file as UTF-8 text. */
export const RAG_ERROR_NOT_TEXT = 'not_text';

/** Terminal: the file does not parse as the format its extension claims — a
 * malformed or encrypted PDF, a corrupt Office archive. */
export const RAG_ERROR_MALFORMED = 'malformed';

/** The organization's secret scan refused the bytes — a policy refusal, not a
 * fault; lifted by removing the credential and uploading again. */
export const RAG_ERROR_SECRET_DETECTED = 'secret_detected';

/** The organization's PII policy blocked the document — a policy refusal,
 * lifted by an admin changing the policy. */
export const RAG_ERROR_PII_BLOCKED = 'pii_blocked';

/** A usage limit that binds whoever the indexing is for — the uploader, a
 * synced drive's owner, nobody for an emailed attachment — has too little
 * room for its embedding requests. Parked, not failed for good: indexing
 * resumes by itself once the limit resets or is raised (the hourly
 * `knowledge.resume_usage_limited` pass), or when someone retries it. */
export const RAG_ERROR_USAGE_LIMIT = 'usage_limit';

/** Anything else the indexer could not classify — a store or database fault
 * on the platform's side; the raw cause is in the platform log, the job
 * retries by itself. */
export const RAG_ERROR_INDEXER_ERROR = 'indexer_error';

/** Every code `indexing.errorCode` can carry — the OpenAPI enum. */
export const RAG_ERROR_CODES = [
  RAG_ERROR_UNSUPPORTED_TYPE,
  RAG_ERROR_IMAGE_NO_VISION,
  RAG_ERROR_EMPTY,
  RAG_ERROR_NOT_TEXT,
  RAG_ERROR_MALFORMED,
  RAG_ERROR_SECRET_DETECTED,
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
  RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
  RAG_ERROR_EMBEDDING_UPSTREAM,
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
  RAG_ERROR_USAGE_LIMIT,
  RAG_ERROR_INDEXER_ERROR,
] as const;

/** The codes a file parks under while its corpus's index is bad: refused
 * during a rebuild, or after a failed one. A healthy index resumes both — a
 * repair the job could not do, an operator may have — and the index health
 * report re-queues every such file then (`requeueRefusedFiles`); the RAG
 * watchdog leaves them to it. */
export const INDEX_PARKED_RAG_ERROR_CODES = [
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
] as const;

/** Every code a file parks under: the corpus's index is bad, or a usage
 * limit binds its indexing. The RAG watchdog leaves them to the passes that
 * resume them (the index health report, the hourly usage-limit re-queue). */
export const PARKED_RAG_ERROR_CODES = [
  ...INDEX_PARKED_RAG_ERROR_CODES,
  RAG_ERROR_USAGE_LIMIT,
] as const;

/** The codes that land on `unsupported`: a retry reproduces the answer, so
 * the retry door refuses instead of queueing. */
export const TERMINAL_RAG_ERROR_CODES: ReadonlySet<string> = new Set([
  RAG_ERROR_UNSUPPORTED_TYPE,
  RAG_ERROR_IMAGE_NO_VISION,
  RAG_ERROR_EMPTY,
  RAG_ERROR_NOT_TEXT,
  RAG_ERROR_MALFORMED,
]);
