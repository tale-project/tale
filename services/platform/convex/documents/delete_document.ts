/**
 * Delete a document (for public API)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function deleteDocument(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
): Promise<void> {
  const document = await ctx.db.get(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  await ctx.db.delete(documentId);
}

