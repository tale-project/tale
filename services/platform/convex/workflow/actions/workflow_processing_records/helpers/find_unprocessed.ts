import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';

import type { TableName, FindUnprocessedResult } from './types';

export async function findUnprocessed(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    tableName: TableName;
    wfDefinitionId: string;
    backoffHours: number;
  },
): Promise<FindUnprocessedResult> {
  const result = await ctx.runQuery(
    internal.workflow_processing_records.findUnprocessed,
    {
      organizationId: params.organizationId,
      tableName: params.tableName,
      wfDefinitionId: params.wfDefinitionId,
      backoffHours: params.backoffHours,
    },
  );

  return {
    documents: result.documents,
    count: result.count,
  };
}
