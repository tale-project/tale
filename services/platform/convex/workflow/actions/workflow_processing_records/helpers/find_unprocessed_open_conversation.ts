import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';

import type { FindUnprocessedResult } from './types';

export async function findUnprocessedOpenConversation(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    workflowId: string;
    backoffHours: number;
  },
): Promise<FindUnprocessedResult> {
  const result = await ctx.runQuery(
    internal.workflow_processing_records.findUnprocessedOpenConversation,
    {
      organizationId: params.organizationId,
      workflowId: params.workflowId,
      backoffHours: params.backoffHours,
    },
  );

  return {
    documents: result.conversations,
    count: result.count,
  };
}

