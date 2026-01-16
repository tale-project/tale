/**
 * Get a document by ID
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';

export async function getDocumentById(
  ctx: QueryCtx,
  documentId: Id<'documents'>,
): Promise<Doc<'documents'> | null> {
  return await ctx.db.get(documentId);
}

