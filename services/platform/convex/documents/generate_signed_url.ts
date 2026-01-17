/**
 * Generate signed URL for a document
 */

import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function generateSignedUrl(
  ctx: QueryCtx,
  documentId: Id<'documents'>,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  // Get the document
  const document = await ctx.db.get(documentId);
  if (!document) {
    return {
      success: false,
      error: 'Document not found',
    };
  }

  // Check if document has a fileId
  if (!document.fileId) {
    return {
      success: false,
      error: 'Document does not have an associated file',
    };
  }

  // Generate signed URL
  const url = await ctx.storage.getUrl(document.fileId);
  if (!url) {
    return {
      success: false,
      error: 'Failed to generate signed URL',
    };
  }

  return {
    success: true,
    url,
  };
}
