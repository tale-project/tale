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
