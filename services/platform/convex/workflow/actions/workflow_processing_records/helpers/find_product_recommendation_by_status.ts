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
  const result = await ctx.runQuery(
    internal.workflow_processing_records.findProductRecommendationByStatus,
    {
      organizationId: params.organizationId,
      wfDefinitionId: params.wfDefinitionId,
      backoffHours: params.backoffHours,
      status: params.status,
    },
  );

  // Return first approval or null (queries always return at most one)
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result.approvals[0] ?? null;
}
