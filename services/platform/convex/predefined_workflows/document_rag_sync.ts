/**
 * Document RAG Sync Workflow
 *
 * This workflow finds one unprocessed document and uploads it to the RAG service.
 *
 * Steps:
 * 1. Find one unprocessed document using find_unprocessed operation
 * 2. Check if a document was found
 * 3. If yes, upload to RAG service
 * 4. If no, finish (nothing to do)
 */

import type { PredefinedWorkflowDefinition } from '../workflows/definitions/types';

const documentRagSyncWorkflow: PredefinedWorkflowDefinition = {
  workflowConfig: {
    name: 'Document RAG Sync',
    description: 'Find one unprocessed document and upload it to RAG service',
    version: '1.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined
    config: {
      timeout: 120000, // 2 minutes for single document upload
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        backoffHours: 72, // Only process documents not processed in last 72 hours (3 days)
        includeMetadata: true, // Include document metadata in upload
        workflowId: 'document_rag_sync',
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'find_unprocessed_document' },
    },

    // Step 2: Find Unprocessed Document
    {
      stepSlug: 'find_unprocessed_document',
      name: 'Find Unprocessed Document',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'documents',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_document_found',
      },
    },

    // Step 3: Check if Document Found
    {
      stepSlug: 'check_document_found',
      name: 'Check Document Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_document.output.data != null',
        description: 'Check if any unprocessed document was found',
      },
      nextSteps: {
        true: 'upload_to_rag',
        false: 'noop', // Special keyword - do nothing and end workflow
      },
    },

    // Step 4: Upload Document to RAG
    {
      stepSlug: 'upload_to_rag',
      name: 'Upload to RAG',
      stepType: 'action',
      order: 4,
      config: {
        type: 'rag',
        parameters: {
          operation: 'upload_document',
          recordId: '{{steps.find_unprocessed_document.output.data._id}}',
        },
      },
      nextSteps: {
        success: 'update_document_metadata',
      },
    },

    // Step 5: Update Document Metadata with RAG Job
    {
      stepSlug: 'update_document_metadata',
      name: 'Update Document Metadata (RAG Job)',
      stepType: 'action',
      order: 5,
      config: {
        type: 'document',
        parameters: {
          operation: 'update',
          documentId: '{{steps.find_unprocessed_document.output.data._id}}',
          metadata: {
            rag_job_id: '{{steps.upload_to_rag.output.data.jobId}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 6: Record Document as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Processed',
      stepType: 'action',
      order: 6,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'documents',
          recordId: '{{steps.find_unprocessed_document.output.data._id}}',
        },
      },
      nextSteps: {
        success: 'noop', // Special keyword - do nothing and end workflow
      },
    },
  ],
};

export default documentRagSyncWorkflow;
