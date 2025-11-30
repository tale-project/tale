import type { RagActionParams } from './types';
import type { ActionCtx } from '../../../_generated/server';
import { api, internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

/**
 * Document information without downloading content
 */
export interface DocumentInfo {
  type: 'text' | 'file';
  content?: string; // Only for text documents
  fileUrl?: string; // Only for file documents
  filename?: string;
  contentType?: string;
  metadata: Record<string, unknown>;
}

/**
 * Get document information from Convex database without downloading file content
 *
 * This is more efficient than readDocument when we only need the signed URL
 * for files, as it avoids downloading the entire file into memory.
 */
export async function getDocumentInfo(
  ctx: ActionCtx,
  params: Extract<RagActionParams, { operation: 'upload_document' }>,
): Promise<DocumentInfo> {
  if (!params.documentId) {
    throw new Error('documentId is required');
  }

  const getDocumentResult = await ctx.runQuery?.(
    internal.documents.getDocumentById,
    {
      documentId: params.documentId as Id<'documents'>,
    },
  );

  if (!getDocumentResult) {
    throw new Error(`Document not found: ${params.documentId}`);
  }

  const document = getDocumentResult as Record<string, unknown>;

  // Check if document has file content
  if (document.fileId) {
    const fileUrl = await ctx.runQuery?.(api.file.getFileUrl, {
      fileId: document.fileId as Id<'_storage'>,
    });

    if (!fileUrl) {
      throw new Error(
        `File URL not available for document ${params.documentId}`,
      );
    }

    const metadata = (document.metadata as Record<string, unknown>) || {};
    return {
      type: 'file',
      fileUrl: fileUrl as string,
      filename:
        (metadata.name as string) || (document.title as string) || 'document',
      contentType:
        (metadata.contentType as string) || 'application/octet-stream',
      metadata: {
        documentId: params.documentId,
        organizationId: params.organizationId,
        title: document.title as string,
        ...metadata,
      },
    };
  }

  // Text content
  if (document.content) {
    return {
      type: 'text',
      content: document.content as string,
      metadata: {
        documentId: params.documentId,
        organizationId: params.organizationId,
        title: document.title as string,
        ...((document.metadata as Record<string, unknown>) || {}),
      },
    };
  }

  throw new Error(`Document has no content or file: ${params.documentId}`);
}
