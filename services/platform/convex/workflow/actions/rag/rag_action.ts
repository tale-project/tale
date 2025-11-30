import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { RagActionParams, RagUploadResult } from './types';
import { getRagConfig } from './get_rag_config';
import { getDocumentInfo } from './get_document_info';
import { uploadTextDocument } from './upload_text_document';
import { uploadFileDirect } from './upload_file_direct';

export const ragAction: ActionDefinition<RagActionParams> = {
  type: 'rag',
  title: 'RAG Document Uploader',
  description:
    'Upload documents to RAG service (cognee) for semantic search and retrieval',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('upload_document'),
      documentId: v.string(),
      organizationId: v.string(),
      forceReupload: v.optional(v.boolean()),
      includeMetadata: v.optional(v.boolean()),
      timeout: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('upload_text'),
      content: v.string(),
      metadata: v.any(),
      timeout: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params) {
    const startTime = Date.now();
    const processedParams = params as RagActionParams;

    // Get RAG service configuration
    const ragConfig = getRagConfig();

    // Upload to RAG service
    let uploadResult: RagUploadResult;
    let documentType: string;

    if (processedParams.operation === 'upload_text') {
      // Direct text upload
      uploadResult = await uploadTextDocument(
        ragConfig.serviceUrl,
        processedParams.content,
        processedParams.metadata,
        processedParams.timeout || 30000,
      );
      documentType = 'text';
    } else {
      // Document upload (from documents table)
      const documentInfo = await getDocumentInfo(ctx, processedParams);

      if (documentInfo.type === 'text') {
        // Upload text content directly
        uploadResult = await uploadTextDocument(
          ragConfig.serviceUrl,
          documentInfo.content as string,
          processedParams.includeMetadata !== false
            ? documentInfo.metadata
            : undefined,
          processedParams.timeout || 30000,
        );
      } else {
        // Upload file directly by downloading from storage and uploading to RAG
        uploadResult = await uploadFileDirect(
          ragConfig.serviceUrl,
          documentInfo.fileUrl as string,
          documentInfo.filename || 'document',
          documentInfo.contentType || 'application/octet-stream',
          processedParams.includeMetadata !== false
            ? documentInfo.metadata
            : undefined,
          processedParams.timeout || 30000,
        );
      }
      documentType = documentInfo.type;
    }

    // Return result with execution metadata
    return {
      ...uploadResult,
      executionTimeMs: Date.now() - startTime,
      documentType,
    };
  },
};
