import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { RagActionParams, RagUploadResult } from './helpers/types';
import { getRagConfig } from './helpers/get_rag_config';
import { getDocumentInfo } from './helpers/get_document_info';
import { uploadTextDocument } from './helpers/upload_text_document';
import { uploadFileDirect } from './helpers/upload_file_direct';

export const ragAction: ActionDefinition<RagActionParams> = {
  type: 'rag',
  title: 'RAG Document Uploader',
  description:
    'Upload documents to RAG service (cognee) for semantic search and retrieval',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('upload_document'),
      recordId: v.string(),
    }),
    v.object({
      operation: v.literal('upload_text'),
      recordId: v.optional(v.string()),
      content: v.string(),
      metadata: v.any(),
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
      // Direct text upload; metadata is passed through as provided
      uploadResult = await uploadTextDocument({
        ragServiceUrl: ragConfig.serviceUrl,
        content: processedParams.content,
        metadata: processedParams.metadata as Record<string, unknown>,
        recordId: processedParams.recordId,
      });
      documentType = 'text';
    } else {
      // Document upload (from documents table)
      const documentInfo = await getDocumentInfo(ctx, processedParams);

      if (documentInfo.type === 'text') {
        // Upload text content directly
        uploadResult = await uploadTextDocument({
          ragServiceUrl: ragConfig.serviceUrl,
          content: documentInfo.content as string,
          metadata: documentInfo.metadata,
        });
      } else {
        // Upload file directly by downloading from storage and uploading to RAG
        uploadResult = await uploadFileDirect({
          ragServiceUrl: ragConfig.serviceUrl,
          fileUrl: documentInfo.fileUrl as string,
          filename: documentInfo.filename || 'document',
          contentType: documentInfo.contentType || 'application/octet-stream',
          metadata: documentInfo.metadata,
        });
      }
      documentType = documentInfo.type;
    }

    // Return result with execution metadata
    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      ...uploadResult,
      executionTimeMs: Date.now() - startTime,
      documentType,
    };
  },
};
