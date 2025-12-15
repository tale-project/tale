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

  // Return first document or null (queries always return at most one)
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result.documents[0] ?? null;
}
