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
import { teamIdToDatasetName, DEFAULT_DATASET_NAME } from '../../../lib/get_user_teams';
import { jsonRecordValidator } from '../../../../lib/shared/validators/utils/json-value';

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

      // Determine dataset name based on team tags
      // If document has team tags, upload to first team's dataset
      // Otherwise, upload to default organization-level dataset
      // Note: If document belongs to multiple teams, we upload to the first one
      // In the future, we may want to upload to all team datasets
      const datasetName =
        documentInfo.teamTags && documentInfo.teamTags.length > 0
          ? teamIdToDatasetName(documentInfo.teamTags[0])
          : DEFAULT_DATASET_NAME;

      if (documentInfo.type === 'text') {
        // Upload text content directly
        uploadResult = await uploadTextDocument({
          ragServiceUrl: ragConfig.serviceUrl,
          content: documentInfo.content as string,
          metadata: documentInfo.metadata,
          datasetName,
        });
      } else {
        // Upload file directly by downloading from storage and uploading to RAG
        uploadResult = await uploadFileDirect({
          ragServiceUrl: ragConfig.serviceUrl,
          fileUrl: documentInfo.fileUrl as string,
          filename: documentInfo.filename || 'document',
          contentType: documentInfo.contentType || 'application/octet-stream',
          metadata: documentInfo.metadata,
          datasetName,
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
        await ctx.runMutation(internal.mutations.documents.updateDocumentRagInfo, {
          documentId,
          ragInfo: {
            status: 'queued',
            jobId: uploadResult.jobId,
          },
        });

        // Schedule first status check in 10 seconds
        await ctx.scheduler.runAfter(
          10 * 1000,
          internal.actions.documents.checkRagJobStatus,
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
