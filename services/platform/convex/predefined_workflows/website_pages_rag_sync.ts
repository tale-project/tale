/**
 * Website Pages RAG Sync Workflow
 *
 * This workflow finds one unprocessed website page and uploads its full record (as JSON) to the RAG service.
 * It follows the standard pattern for entity-processing workflows:
 * 1. Find one unprocessed entity using workflow_processing_records
 * 2. Upload the entity to RAG
 * 3. Record it as processed
 */

const websitePagesRagSyncWorkflow = {
  workflowConfig: {
    name: 'Website Pages RAG Sync',
    description:
      'Find one unprocessed website page and upload it to the RAG service',
    version: '1.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 120000,
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        backoffHours: 72,
        workflowId: 'website_pages_rag_sync',
      },
    },
  },
  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'find_unprocessed_page' },
    },
    {
      stepSlug: 'find_unprocessed_page',
      name: 'Find Unprocessed Website Page',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'websitePages',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_page_found',
      },
    },
    {
      stepSlug: 'check_page_found',
      name: 'Check Page Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_page.output.data != null',
        description: 'Check if any unprocessed website page was found',
      },
      nextSteps: {
        true: 'upload_to_rag',
        false: 'noop',
      },
    },
    {
      stepSlug: 'upload_to_rag',
      name: 'Upload to RAG',
      stepType: 'action',
      order: 4,
      config: {
        type: 'rag',
        parameters: {
          operation: 'upload_text',
          recordId: '{{steps.find_unprocessed_page.output.data._id}}',
          content: '{{steps.find_unprocessed_page.output.data|string}}',
          metadata: {
            websiteId: '{{steps.find_unprocessed_page.output.data.websiteId}}',
            _id: '{{steps.find_unprocessed_page.output.data._id}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },
    {
      stepSlug: 'record_processed',
      name: 'Record Processed',
      stepType: 'action',
      order: 5,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'websitePages',
          recordId: '{{steps.find_unprocessed_page.output.data._id}}',
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default websitePagesRagSyncWorkflow;
