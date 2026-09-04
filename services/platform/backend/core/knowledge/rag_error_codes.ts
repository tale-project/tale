/**
 * Stable machine-readable causes for `fileMetadata.ragError`, persisted next to
 * the prose so surfaces can attach guidance (deep links, role-aware hints)
 * without sniffing English message text that is free to change.
 *
 * Deliberately dependency-free: the client imports these literals too (the
 * failed-indexing dialog), and the modules that raise the errors are
 * `'use node'` server code it must never pull in.
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
