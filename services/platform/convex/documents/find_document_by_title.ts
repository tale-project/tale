/**
 * Find a document by title within an organization
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function findDocumentByTitle(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    title: string;
  },
): Promise<Doc<'documents'> | null> {
  const document = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_title', (q) =>
      q.eq('organizationId', args.organizationId).eq('title', args.title),
    )
    .unique();

  return document;
}
