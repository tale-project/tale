/**
 * Generate signed URL for a document
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { buildDownloadUrl } from '../lib/helpers/public_storage_url';

export async function generateSignedUrl(
  ctx: QueryCtx,
  documentId: Id<'documents'>,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const document = await ctx.db.get(documentId);
  if (!document) {
    return {
      success: false,
      error: 'Document not found',
    };
  }

  if (!document.fileId) {
    return {
      success: false,
      error: 'Document does not have an associated file',
    };
  }

  return {
    success: true,
    url: buildDownloadUrl(document.fileId, document.title ?? 'download'),
  };
}
