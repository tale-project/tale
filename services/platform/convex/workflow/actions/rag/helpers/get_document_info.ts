import type { RagActionParams } from './types';
import type { ActionCtx } from '../../../../_generated/server';
import { api, internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';

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
  params:
    | Extract<RagActionParams, { operation: 'upload_document' }>
    | Extract<RagActionParams, { operation: 'delete_document' }>,
): Promise<DocumentInfo> {
  if (!params.recordId) {
    throw new Error('recordId is required');
  }

  const getDocumentResult = await ctx.runQuery?.(
    internal.documents.getDocumentById,
    {
      documentId: params.recordId as Id<'documents'>,
    },
  );

  if (!getDocumentResult) {
    throw new Error(`Document not found: ${params.recordId}`);
  }

  const document = getDocumentResult as Record<string, unknown>;
  const baseMetadata =
    (document.metadata as Record<string, unknown> | undefined) || {};
  const organizationId = document.organizationId as string | undefined;

  // Check if document has file content
  if (document.fileId) {
    const fileUrl = await ctx.runQuery?.(api.file.getFileUrl, {
      fileId: document.fileId as Id<'_storage'>,
    });

    if (!fileUrl) {
      throw new Error(`File URL not available for document ${params.recordId}`);
    }

    return {
      type: 'file',
      fileUrl: fileUrl as string,
      filename:
        (baseMetadata.name as string) ||
        (document.title as string) ||
        'document',
      contentType:
        (baseMetadata.contentType as string) || 'application/octet-stream',
      metadata: {
        recordId: params.recordId,
        organizationId,
        title: document.title as string,
        ...baseMetadata,
      },
    };
  }

  // Text content
  if (document.content) {
    return {
      type: 'text',
      content: document.content as string,
      metadata: {
        recordId: params.recordId,
        organizationId,
        title: document.title as string,
        ...baseMetadata,
      },
    };
  }

  throw new Error(`Document has no content or file: ${params.recordId}`);
}

