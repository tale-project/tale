/**
 * Helper function to trigger a specific workflow manually
 */

import type { Id, Doc } from '../../../_generated/dataModel';

import { internal } from '../../../_generated/api';
import { ActionCtx } from '../../../_generated/server';
import { toConvexJsonValue } from '../../../lib/type_cast_helpers';

export interface TriggerWorkflowByIdArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  input?: unknown;
  triggeredBy?: string;
}

export async function triggerWorkflowById(
  ctx: ActionCtx,
  args: TriggerWorkflowByIdArgs,
): Promise<string> {
  const workflow = (await ctx.runQuery(
    internal.wf_definitions.internal_queries.resolveWorkflow,
    {
      wfDefinitionId: args.wfDefinitionId,
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex document field
  )) as unknown as Doc<'wfDefinitions'> | null;

  if (!workflow) {
    throw new Error('Workflow not found');
  }

  // Allow both 'active' and 'draft' workflows to be triggered
  // This enables testing and development without requiring activation
  if (workflow.status !== 'active' && workflow.status !== 'draft') {
    throw new Error(
      `Workflow cannot be triggered with status: ${workflow.status}`,
    );
  }

  const handle: string = await ctx.runMutation(
    internal.workflow_engine.internal_mutations.startWorkflow,
    {
      organizationId: workflow.organizationId,
      wfDefinitionId: args.wfDefinitionId,
      input: toConvexJsonValue(args.input || {}),
      triggeredBy: args.triggeredBy || 'manual',
      triggerData: {
        triggerType: 'manual',
        timestamp: Date.now(),
      },
    },
  );

  return handle;
}
