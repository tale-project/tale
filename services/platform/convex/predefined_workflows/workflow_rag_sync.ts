/**
 * Workflow RAG Sync Workflow
 *
 * This workflow uploads all predefined workflow definitions to the RAG service.
 * This allows the RAG service to provide context about available workflows
 * when users ask questions about workflow capabilities.
 *
 * Steps:
 * 1. Trigger (manual or scheduled)
 * 2. Upload all workflow definitions to RAG service
 */

const workflowRagSyncWorkflow = {
  workflowConfig: {
    name: 'Workflow RAG Sync',
    description:
      'Upload all predefined workflow definitions to RAG service for context',
    version: '1.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined
    config: {
      timeout: 600000, // 10 minutes for uploading all workflows
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'Start Workflow RAG Sync',
      stepType: 'start',
      order: 1,
      config: {
        type: 'manual',
        // For scheduled sync, uncomment below:
        // schedule: '0 0 * * *', // Daily at midnight
        // timezone: 'UTC',
      },
      nextSteps: { success: 'upload_workflows' },
    },

    // Step 2: Upload Workflows to RAG
    {
      stepSlug: 'upload_workflows',
      name: 'Upload Workflows to RAG',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow',
        parameters: {
          operation: 'upload_all_workflows',
          timeout: 120000, // 2 minutes per workflow
        },
      },
      nextSteps: {
        success: 'noop', // Special keyword - do nothing and end workflow
      },
    },
  ],
};

export default workflowRagSyncWorkflow;
