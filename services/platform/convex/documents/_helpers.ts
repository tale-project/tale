import type { Doc } from '../_generated/dataModel';

/**
 * Documents flipped out of `'active'` via WebDAV soft-delete, the trash UI, or
 * the retention pipeline must not surface in normal listing/search/agent-scope
 * queries. Active rows have `lifecycleStatus === 'active'` or `undefined`
 * (legacy rows before the field existed). Every OTHER state — `'trashed'`,
 * `'expired'` (retention grace window), `'deleted'` (purge-pending) — is
 * inactive: a doc in any of those is shown in Trash, not in working listings,
 * and must stay out of agent RAG retrieval scope. Use this in every read
 * pipeline so the filter stays consistent across files.
 */
export function isActiveDocument(
  doc: Pick<Doc<'documents'>, 'lifecycleStatus'>,
): boolean {
  return (doc.lifecycleStatus ?? 'active') === 'active';
}
