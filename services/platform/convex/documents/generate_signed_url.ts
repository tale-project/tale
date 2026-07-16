/**
 * Generate signed URL for a document
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  buildBlobServeUrl,
  buildDownloadUrl,
} from '../lib/helpers/public_storage_url';
import { isS3Ref } from '../lib/storage/blob_ref';

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

  // An `s3:` blob is served through the node `/storage` route (which presigns
  // + 302-redirects); the `org` param addresses the right bucket. A Convex
  // blob keeps the direct `/storage?id=` download URL.
  const fileName = document.title ?? 'download';
  return {
    success: true,
    url: isS3Ref(document.fileId)
      ? buildBlobServeUrl(
          String(document.fileId),
          document.organizationId,
          fileName,
        )
      : buildDownloadUrl(document.fileId, fileName),
  };
}
