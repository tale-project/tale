/**
 * Helper function to trigger a specific workflow manually
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type { Id, Doc } from '../../../_generated/dataModel';
import { Infer } from 'convex/values';
import { jsonValueValidator } from '../../../../lib/shared/schemas/utils/json-value';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;

export interface TriggerWorkflowByIdArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  input?: unknown;
  triggeredBy?: string;
}

export async function triggerWorkflowById(
  ctx: ActionCtx,
  args: TriggerWorkflowByIdArgs,
): Promise<string> {
  const workflow = (await ctx.runQuery(internal.wf_definitions.queries.resolveWorkflow, {
    wfDefinitionId: args.wfDefinitionId,
  })) as unknown as Doc<'wfDefinitions'> | null;

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
    internal.workflow_engine.mutations.internalStartWorkflow,
    {
      organizationId: workflow.organizationId,
      wfDefinitionId: args.wfDefinitionId,
      input: (args.input || {}) as ConvexJsonValue,
      triggeredBy: args.triggeredBy || 'manual',
      triggerData: {
        triggerType: 'manual',
        timestamp: Date.now(),
      },
    },
  );

  return handle;
}
