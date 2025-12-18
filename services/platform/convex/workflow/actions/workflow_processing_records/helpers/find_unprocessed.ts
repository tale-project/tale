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
  const result = await ctx.runMutation(
    internal.workflow_processing_records.findUnprocessed,
    {
      organizationId: params.organizationId,
      tableName: params.tableName,
      wfDefinitionId: params.wfDefinitionId,
      backoffHours: params.backoffHours,
    },
  );

  // Return the document or null.
  // The underlying Convex function is a mutation that atomically claims
  // the returned record to avoid concurrent workflows processing the same entity.
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result.document;
}
