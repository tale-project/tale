/**
 * Find document by storage file ID within an organization.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { toId } from '../lib/type_cast_helpers';
import { isActiveDocument } from './_helpers';

export async function findDocumentByFileId(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    fileId: string;
  },
): Promise<Doc<'documents'> | null> {
  const doc = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_fileId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('fileId', toId<'_storage'>(args.fileId)),
    )
    .first();
  // A trashed/expired doc (e.g. WebDAV DELETE leaves the row + blob live) must
  // not resolve by fileId for agent retrieval / workflow access — treat as
  // absent. Callers already handle null.
  if (!doc || !doc.fileId || !isActiveDocument(doc)) return null;
  const fileId = doc.fileId;

  // Inline-content fallback is part of `rag_fetch`, so it must obey the same
  // completion/current-binding gate as the SQL corpus path.
  const metadata = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
    .first();
  if (
    metadata === null ||
    metadata.organizationId !== args.organizationId ||
    metadata.ragStatus !== 'completed' ||
    metadata.documentId !== doc._id ||
    metadata.lifecycleStatus === 'trashed'
  ) {
    return null;
  }
  return doc;
}
