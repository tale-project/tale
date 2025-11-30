/**
 * Workflow Action Parameters
 */
export interface WorkflowActionParams {
  operation: 'upload_all_workflows';
  organizationId: string;
  timeout?: number;
}

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
