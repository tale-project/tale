/**
 * Customer RAG Sync Workflow
 *
 * This workflow finds one unprocessed customer and uploads it to the RAG service.
 *
 * Steps:
 * 1. Trigger (manual or scheduled)
 * 2. Find one unprocessed customer using find_unprocessed operation
 * 3. Check if a customer was found
 * 4. If yes, upload customer data to RAG service
 * 5. Record customer as processed
 * 6. If no customer found, finish (nothing to do)
 */

const customerRagSyncWorkflow = {
  workflowConfig: {
    name: 'Customer RAG Sync',
    description: 'Find one unprocessed customer and upload it to RAG service',
    version: '1.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined
    config: {
      timeout: 120000, // 2 minutes for single customer upload
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        backoffHours: 72, // Only process customers not processed in last 72 hours (3 days)
        workflowId: 'customer_rag_sync',
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
      nextSteps: { success: 'find_unprocessed_customer' },
    },

    // Step 2: Find Unprocessed Customer
    {
      stepSlug: 'find_unprocessed_customer',
      name: 'Find Unprocessed Customer',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'customers',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_customer_found',
      },
    },

    // Step 3: Check if Customer Found
    {
      stepSlug: 'check_customer_found',
      name: 'Check Customer Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_customer.output.data != null',
        description: 'Check if any unprocessed customer was found',
      },
      nextSteps: {
        true: 'upload_to_rag',
        false: 'noop', // Special keyword - do nothing and end workflow
      },
    },

    // Step 4: Upload Customer to RAG
    {
      stepSlug: 'upload_to_rag',
      name: 'Upload to RAG',
      stepType: 'action',
      order: 4,
      config: {
        type: 'rag',
        parameters: {
          operation: 'upload_text',
          recordId: '{{steps.find_unprocessed_customer.output.data._id}}',
          content: '{{steps.find_unprocessed_customer.output.data|string}}',
          metadata: {
            _id: '{{steps.find_unprocessed_customer.output.data._id}}',
          },
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 5: Record Customer as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Processed',
      stepType: 'action',
      order: 5,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'customers',
          recordId: '{{steps.find_unprocessed_customer.output.data._id}}',
        },
      },
      nextSteps: {
        success: 'noop', // Special keyword - do nothing and end workflow
      },
    },
  ],
};

export default customerRagSyncWorkflow;
