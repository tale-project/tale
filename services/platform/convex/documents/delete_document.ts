/**
 * Delete a document (for public API)
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function deleteDocument(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
): Promise<void> {
  const document = await ctx.db.get(documentId);
  if (!document) {
    throw new ConvexError({
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Document not found',
    });
  }

  await ctx.db.delete(documentId);
}
