import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';

import type { FindUnprocessedResult } from './types';

export async function findUnprocessedOpenConversation(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    wfDefinitionId: string;
    backoffHours: number;
  },
): Promise<FindUnprocessedResult> {
  const result = await ctx.runMutation(
    internal.workflow_processing_records.findUnprocessedOpenConversation,
    {
      organizationId: params.organizationId,
      wfDefinitionId: params.wfDefinitionId,
      backoffHours: params.backoffHours,
    },
  );

  // Return the conversation or null
  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return result.conversation;
}
