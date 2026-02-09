/**
 * Delete a document (for public API)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

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
