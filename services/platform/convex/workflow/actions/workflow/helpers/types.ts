/**
 * Workflow Action Parameters
 * Note: organizationId is automatically read from workflow context variables
 */

// Discriminated union type for workflow operations
export type WorkflowActionParams = {
  operation: 'upload_all_workflows';
  timeout?: number;
};

/**
 * Upload All Workflows Result
 */
export interface UploadAllWorkflowsResult {
  success: boolean;
  uploaded: number;
  failed: number;
  errors: string[];
  details: Array<{
    workflowKey: string;
    workflowName: string;
    status: 'success' | 'failed';
    error?: string;
  }>;
  executionTimeMs?: number;
}

