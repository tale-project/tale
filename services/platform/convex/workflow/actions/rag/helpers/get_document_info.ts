import type { RagActionParams } from './types';
import type { ActionCtx } from '../../../../_generated/server';
import { api, internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { DocumentMetadata } from '../../../../model/documents/types';

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
  /** Team tags for multi-tenancy - determines which datasets the document belongs to */
  teamTags?: string[];
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
  if (!params.recordId) {
    throw new Error('recordId is required');
  }

  const document = await ctx.runQuery?.(internal.queries.documents.getDocumentById, {
    documentId: params.recordId as Id<'documents'>,
  });

  if (!document) {
    throw new Error(`Document not found: ${params.recordId}`);
  }

  // Type the metadata for safe access
  const baseMetadata = (document.metadata as DocumentMetadata | undefined) || {};
  const organizationId = document.organizationId;

  // Check if document has file content
  if (document.fileId) {
    const fileUrl = await ctx.runQuery?.(api.queries.file.getFileUrl, {
      fileId: document.fileId,
    });

    if (!fileUrl) {
      throw new Error(`File URL not available for document ${params.recordId}`);
    }

    return {
      type: 'file',
      fileUrl,
      filename: baseMetadata.name || document.title || 'document',
      contentType: baseMetadata.mimeType || 'application/octet-stream',
      metadata: {
        recordId: params.recordId,
        organizationId,
        title: document.title,
        ...baseMetadata,
      },
      teamTags: document.teamTags,
    };
  }

  // Text content
  if (document.content) {
    return {
      type: 'text',
      content: document.content,
      metadata: {
        recordId: params.recordId,
        organizationId,
        title: document.title,
        ...baseMetadata,
      },
      teamTags: document.teamTags,
    };
  }

  throw new Error(`Document has no content or file: ${params.recordId}`);
}

