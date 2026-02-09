/**
 * Find document by external ID (e.g., OneDrive item ID)
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function findDocumentByExternalId(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    externalItemId: string;
  },
): Promise<Doc<'documents'> | null> {
  return await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_externalItemId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('externalItemId', args.externalItemId),
    )
    .first();
}
