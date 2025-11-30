/**
 * Product RAG Sync Workflow
 *
 * This workflow finds one unprocessed product and uploads it to the RAG service.
 *
 * Steps:
 * 1. Trigger (manual or scheduled)
 * 2. Find one unprocessed product using find_unprocessed operation
 * 3. Check if a product was found
 * 4. If yes, upload product data to RAG service
 * 5. Record product as processed
 * 6. If no product found, finish (nothing to do)
 */

export const productRagSyncWorkflow = {
  workflowConfig: {
    name: 'Product RAG Sync',
    description: 'Find one unprocessed product and upload it to RAG service',
    version: '1.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined
    config: {
      timeout: 120000, // 2 minutes for single product upload
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        backoffHours: 72, // Only process products not processed in last 72 hours (3 days)
        workflowId: 'product_rag_sync',
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual',
      },
      nextSteps: { success: 'find_unprocessed_product' },
    },

    // Step 2: Find Unprocessed Product
    {
      stepSlug: 'find_unprocessed_product',
      name: 'Find Unprocessed Product',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          organizationId: '{{organizationId}}',
          tableName: 'products',
          workflowId: '{{workflowId}}',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_product_found',
      },
    },

    // Step 3: Check if Product Found
    {
      stepSlug: 'check_product_found',
      name: 'Check Product Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed_product.output.data.count > 0',
        description: 'Check if any unprocessed product was found',
      },
      nextSteps: {
        true: 'upload_to_rag',
        false: 'noop', // Special keyword - do nothing and end workflow
      },
    },

    // Step 4: Upload Product to RAG
    {
      stepSlug: 'upload_to_rag',
      name: 'Upload to RAG',
      stepType: 'action',
      order: 4,
      config: {
        type: 'rag',
        parameters: {
          operation: 'upload_text',
          content:
            'Product: {{steps.find_unprocessed_product.output.data.documents[0].name}}\nID: {{steps.find_unprocessed_product.output.data.documents[0]._id}}\nDescription: {{steps.find_unprocessed_product.output.data.documents[0].description}}\nCategory: {{steps.find_unprocessed_product.output.data.documents[0].category}}\nPrice: {{steps.find_unprocessed_product.output.data.documents[0].price}} {{steps.find_unprocessed_product.output.data.documents[0].currency}}\nStock: {{steps.find_unprocessed_product.output.data.documents[0].stock}}\nStatus: {{steps.find_unprocessed_product.output.data.documents[0].status}}\nTags: {{steps.find_unprocessed_product.output.data.documents[0].tags | string}}\nExternal ID: {{steps.find_unprocessed_product.output.data.documents[0].externalId}}\nImage URL: {{steps.find_unprocessed_product.output.data.documents[0].imageUrl}}\nAdditional Metadata: {{steps.find_unprocessed_product.output.data.documents[0].metadata | string}}',
          metadata:
            '{{steps.find_unprocessed_product.output.data.documents[0]}}',
          timeout: 600000, // 10 minutes for text upload
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 5: Record Product as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Processed',
      stepType: 'action',
      order: 5,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          organizationId: '{{organizationId}}',
          tableName: 'products',
          documentId:
            '{{steps.find_unprocessed_product.output.data.documents[0]._id}}',
          documentCreationTime:
            '{{steps.find_unprocessed_product.output.data.documents[0]._creationTime}}',
          workflowId: '{{workflowId}}',
        },
      },
      nextSteps: {
        success: 'noop', // Special keyword - do nothing and end workflow
      },
    },
  ],
};

export default productRagSyncWorkflow;
