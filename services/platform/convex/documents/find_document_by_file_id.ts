/**
 * Find document by storage file ID within an organization.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { toId } from '../lib/type_cast_helpers';

export async function findDocumentByFileId(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    fileId: string;
  },
): Promise<Doc<'documents'> | null> {
  return await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_fileId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('fileId', toId<'_storage'>(args.fileId)),
    )
    .first();
}
