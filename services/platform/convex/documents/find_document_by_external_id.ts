/**
 * Find document by external ID (e.g., OneDrive item ID, Google Drive file ID).
 *
 * Optionally scope to a target folder. When `folderId` is provided (or `null`
 * for the root), only docs in that folder are considered — useful for sync
 * flows where the same external file may be synced to multiple Tale folders
 * via separate sync configs (each gets its own document row).
 *
 * When `folderId` is undefined, returns the first match in any folder
 * (legacy behavior, kept for callers like the OneDrive importer).
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function findDocumentByExternalId(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    externalItemId: string;
    folderId?: Id<'folders'> | null;
  },
): Promise<Doc<'documents'> | null> {
  const candidates = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_externalItemId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('externalItemId', args.externalItemId),
    );

  if (args.folderId === undefined) {
    return await candidates.first();
  }

  // Scoped match: same external item id AND same folder. The expected count
  // here is at most 1 in normal usage, so a small in-memory filter is fine.
  const target = args.folderId;
  for await (const doc of candidates) {
    if ((doc.folderId ?? null) === target) return doc;
  }
  return null;
}
