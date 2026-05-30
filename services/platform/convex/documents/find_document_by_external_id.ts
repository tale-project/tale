/**
 * Find document by external ID (e.g., OneDrive item ID, Google Drive file ID).
 *
 * Optional scope:
 *  - `folderId` matches docs in exactly that folder (`null` for the root).
 *  - `folderPathPrefix` matches docs whose `folderPath` equals the prefix or
 *    sits under it (`prefix + '/'`). Used by sync workflows to confine the
 *    cross-folder fallback to a single sync's subtree, so two independent
 *    sync configs targeting the same external file do not ping-pong rows.
 *
 * Without either scope, returns the first match in any folder (legacy
 * behavior, kept for callers like the OneDrive importer).
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function findDocumentByExternalId(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    externalItemId: string;
    folderId?: Id<'folders'> | null;
    folderPathPrefix?: string;
  },
): Promise<Doc<'documents'> | null> {
  const candidates = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_externalItemId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('externalItemId', args.externalItemId),
    );

  const folderIdScope = args.folderId;
  const prefix = args.folderPathPrefix;

  // NOTE: intentionally does NOT filter on lifecycleStatus (unlike the agent /
  // public read paths that use isActiveDocument). This backs the external-sync
  // reconcile/upsert keyed by externalItemId. If we hid a trashed-but-same-id
  // row here, the upsert's "existing" lookup would return null and the next
  // sync sweep would RE-CREATE the document the user just trashed (resurrection
  // / duplicate rows). Returning the trashed row lets reconcile update it in
  // place. Read surfaces that must hide trashed docs do so at their own call
  // site, not in this shared sync-key lookup.
  // The expected match count for these scopes is at most 1 in normal usage,
  // so a small in-memory filter is fine.
  for await (const doc of candidates) {
    if (folderIdScope !== undefined) {
      if ((doc.folderId ?? null) !== folderIdScope) continue;
    }
    if (prefix !== undefined && prefix.length > 0) {
      const path = doc.folderPath ?? '';
      if (path !== prefix && !path.startsWith(prefix + '/')) continue;
    }
    return doc;
  }
  return null;
}
