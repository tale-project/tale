import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

import type { FindUnprocessedResult } from './types';

export async function findProductRecommendationByStatus(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    workflowId: string;
    backoffHours: number;
    status: 'pending' | 'approved' | 'rejected';
  },
): Promise<FindUnprocessedResult> {
  console.log({ params });
  const result = await ctx.runQuery(
    internal.workflow_processing_records.findProductRecommendationByStatus,
    {
      organizationId: params.organizationId,
      workflowId: params.workflowId,
      backoffHours: params.backoffHours,
      status: params.status,
    },
  );

  return {
    documents: result.approvals,
    count: result.count,
  };
}
