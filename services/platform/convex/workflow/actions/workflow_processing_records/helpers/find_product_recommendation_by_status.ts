import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';

import type { FindUnprocessedResult } from './types';

import { createDebugLog } from '../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export async function findProductRecommendationByStatus(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    wfDefinitionId: string;
    backoffHours: number;
    status: 'pending' | 'approved' | 'rejected';
  },
): Promise<FindUnprocessedResult> {
  debugLog({ params });
  const result = await ctx.runMutation(
    internal.workflow_processing_records.findProductRecommendationByStatus,
    {
      organizationId: params.organizationId,
      wfDefinitionId: params.wfDefinitionId,
      backoffHours: params.backoffHours,
      status: params.status,
    },
  );

  // Return the approval or null
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result.approval;
}
