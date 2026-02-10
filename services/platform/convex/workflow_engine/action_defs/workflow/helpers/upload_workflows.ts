import type { UploadAllWorkflowsResult } from './types';

import {
  isRecord,
  getString,
  getRecord,
} from '../../../../../lib/utils/type-guards';
import { createDebugLog } from '../../../../lib/debug_log';
import * as workflowExports from '../../../../predefined_workflows';
import { getRagConfig } from '../../rag/helpers/get_rag_config';
import { uploadTextDocument } from '../../rag/helpers/upload_text_document';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

/**
 * Upload all predefined workflow definitions to RAG service
 */
export async function uploadAllWorkflows(
  organizationId: string,
  timeout = 120000,
): Promise<UploadAllWorkflowsResult> {
  debugLog(
    'Workflow RAG Upload Starting upload of predefined workflows to RAG service...',
  );
  debugLog(`Workflow RAG Upload Organization ID: ${organizationId}`);

  const ragConfig = getRagConfig();
  debugLog(`Workflow RAG Upload RAG Service URL: ${ragConfig.serviceUrl}`);

  let uploaded = 0;
  const details: Array<{
    workflowKey: string;
    workflowName: string;
    status: 'success' | 'failed';
    error?: string;
  }> = [];

  // Upload individual workflows
  debugLog(
    `Workflow RAG Upload Uploading ${Object.keys(workflowExports.workflows).length} individual workflows...`,
  );

  for (const [key, workflow] of Object.entries(workflowExports.workflows)) {
    debugLog(`Workflow RAG Upload Processing workflow: ${key}`);

    // Serialize workflow definition to JSON
    const content = JSON.stringify(workflow, null, 2);

    // Extract workflow metadata
    const workflowRec = isRecord(workflow) ? workflow : undefined;
    const workflowConfig = workflowRec
      ? getRecord(workflowRec, 'workflowConfig')
      : undefined;
    const workflowName =
      (workflowConfig ? getString(workflowConfig, 'name') : undefined) ||
      'Unknown Workflow';
    const workflowDescription =
      (workflowConfig ? getString(workflowConfig, 'description') : undefined) ||
      '';
    const workflowType =
      (workflowConfig
        ? getString(workflowConfig, 'workflowType')
        : undefined) || 'predefined';

    // Upload to RAG service
    const result = await uploadTextDocument({
      ragServiceUrl: ragConfig.serviceUrl,
      content,
      metadata: {
        recordId: `workflow_${key}`,
        workflowKey: key,
        workflowName: workflowName,
        workflowDescription: workflowDescription,
        workflowType: workflowType,
        category: 'workflow_definition',
        organizationId: organizationId,
        uploadedAt: Date.now(),
      },
      timeoutMs: timeout,
    });

    debugLog(
      `Workflow RAG Upload ✓ Successfully uploaded: ${key} (${result.chunksCreated} chunks)`,
    );

    uploaded++;
    details.push({
      workflowKey: key,
      workflowName: workflowName,
      status: 'success',
    });
  }

  debugLog('Workflow RAG Upload Upload complete!');
  debugLog(`Workflow RAG Upload Successfully uploaded: ${uploaded}`);

  return {
    success: true,
    uploaded,
    failed: 0,
    errors: [],
    details,
  };
}
