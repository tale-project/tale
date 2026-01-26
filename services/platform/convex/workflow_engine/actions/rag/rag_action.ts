import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { RagActionParams, RagUploadResult } from './helpers/types';
import { getRagConfig } from './helpers/get_rag_config';
import { getDocumentInfo } from './helpers/get_document_info';
import { uploadTextDocument } from './helpers/upload_text_document';
import { uploadFileDirect } from './helpers/upload_file_direct';
import { deleteDocumentById } from './helpers/delete_document';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { jsonRecordValidator } from '../../../../lib/shared/schemas/utils/json-value';

export const ragAction: ActionDefinition<RagActionParams> = {
  type: 'rag',
  title: 'RAG Document Manager',
  description:
    'Upload or delete documents in RAG service (cognee) for semantic search and retrieval',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('upload_document'),
      recordId: v.string(),
    }),
    v.object({
      operation: v.literal('upload_text'),
      recordId: v.optional(v.string()),
      content: v.string(),
      metadata: jsonRecordValidator,
    }),
    v.object({
      operation: v.literal('delete_document'),
      recordId: v.string(),
      mode: v.optional(v.union(v.literal('soft'), v.literal('hard'))),
    }),
  ),

  async execute(ctx, params) {
    const startTime = Date.now();
    const processedParams = params as RagActionParams;

    // Get RAG service configuration
    const ragConfig = getRagConfig();

    // Handle delete operation - use the recordId directly as the document ID
    // The recordId (Convex document ID) is stored in Cognee's node_set when uploading
    if (processedParams.operation === 'delete_document') {
      const deleteResult = await deleteDocumentById({
        ragServiceUrl: ragConfig.serviceUrl,
        documentId: processedParams.recordId,
        mode: processedParams.mode || 'hard',
      });

      return {
        ...deleteResult,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Handle upload operations
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

      // Pass team IDs directly to RAG service (it handles the conversion internally)
      // If document has team tags, use them; otherwise use organization ID as fallback (public document)
      // This allows public documents to be accessible by all teams within the organization
      const teamIds = documentInfo.teamTags && documentInfo.teamTags.length > 0
        ? documentInfo.teamTags
        : [`org_${documentInfo.metadata.organizationId}`];

      if (documentInfo.type === 'text') {
        // Upload text content directly
        uploadResult = await uploadTextDocument({
          ragServiceUrl: ragConfig.serviceUrl,
          content: documentInfo.content as string,
          metadata: documentInfo.metadata,
          teamIds,
        });
      } else {
        // Upload file directly by downloading from storage and uploading to RAG
        uploadResult = await uploadFileDirect({
          ragServiceUrl: ragConfig.serviceUrl,
          fileUrl: documentInfo.fileUrl as string,
          filename: documentInfo.filename || 'document',
          contentType: documentInfo.contentType || 'application/octet-stream',
          metadata: documentInfo.metadata,
          teamIds,
        });
      }
      documentType = documentInfo.type;
    }

    // Update document ragInfo and schedule status check (for document uploads only)
    if (
      processedParams.operation === 'upload_document' &&
      uploadResult.success &&
      uploadResult.jobId
    ) {
      const documentId = processedParams.recordId as Id<'documents'>;

      try {
        // Update document with ragInfo = queued
        await ctx.runMutation(internal.documents.mutations.updateDocumentRagInfo, {
          documentId,
          ragInfo: {
            status: 'queued',
            jobId: uploadResult.jobId,
          },
        });

        // Schedule first status check in 10 seconds
        await ctx.scheduler.runAfter(
          10 * 1000,
          internal.documents.actions.checkRagJobStatus,
          { documentId, attempt: 1 },
        );
      } catch (error) {
        // Log but don't fail the upload - ragInfo update is best-effort
        console.error('[ragAction] Failed to update ragInfo:', error);
      }
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
