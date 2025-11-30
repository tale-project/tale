import type { UploadAllWorkflowsResult } from './types';
import * as workflowExports from '../../../predefined_workflows';
import { getRagConfig } from '../rag/get_rag_config';
import { uploadTextDocument } from '../rag/upload_text_document';

/**
 * Upload all predefined workflow definitions to RAG service
 */
export async function uploadAllWorkflows(
  organizationId: string,
  timeout = 120000,
): Promise<UploadAllWorkflowsResult> {
  console.log(
    `[Workflow RAG Upload] Starting upload of predefined workflows to RAG service...`,
  );
  console.log(`[Workflow RAG Upload] Organization ID: ${organizationId}`);

  const ragConfig = getRagConfig();
  console.log(`[Workflow RAG Upload] RAG Service URL: ${ragConfig.serviceUrl}`);

  let uploaded = 0;
  const details: Array<{
    workflowKey: string;
    workflowName: string;
    status: 'success' | 'failed';
    error?: string;
  }> = [];

  // Upload individual workflows
  console.log(
    `[Workflow RAG Upload] Uploading ${Object.keys(workflowExports.workflows).length} individual workflows...`,
  );

  for (const [key, workflow] of Object.entries(workflowExports.workflows)) {
    console.log(`[Workflow RAG Upload] Processing workflow: ${key}`);

    // Serialize workflow definition to JSON
    const content = JSON.stringify(workflow, null, 2);

    // Extract workflow metadata
    const workflowConfig = (workflow as unknown as { workflowConfig?: unknown })
      .workflowConfig as Record<string, unknown> | undefined;
    const workflowName = (workflowConfig?.name as string) || 'Unknown Workflow';
    const workflowDescription = (workflowConfig?.description as string) || '';
    const workflowType =
      (workflowConfig?.workflowType as string) || 'predefined';

    // Upload to RAG service
    const result = await uploadTextDocument(
      ragConfig.serviceUrl,
      content,
      {
        documentId: `workflow_${key}`,
        workflowKey: key,
        workflowName: workflowName,
        workflowDescription: workflowDescription,
        workflowType: workflowType,
        category: 'workflow_definition',
        organizationId: organizationId,
        uploadedAt: Date.now(),
      },
      timeout,
    );

    console.log(
      `[Workflow RAG Upload] ✓ Successfully uploaded: ${key} (${result.chunksCreated} chunks)`,
    );

    uploaded++;
    details.push({
      workflowKey: key,
      workflowName: workflowName as string,
      status: 'success',
    });
  }

  console.log(`[Workflow RAG Upload] Upload complete!`);
  console.log(`[Workflow RAG Upload] Successfully uploaded: ${uploaded}`);

  return {
    success: true,
    uploaded,
    failed: 0,
    errors: [],
    details,
  };
}
