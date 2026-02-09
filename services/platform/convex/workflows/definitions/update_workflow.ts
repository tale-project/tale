/**
 * Update workflow
 */

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { WorkflowConfig } from './types';

export interface UpdateWorkflowArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  updates: {
    name?: string;
    description?: string;
    version?: string;
    status?: string;
    workflowType?: 'predefined';
    config?: WorkflowConfig;
    metadata?: unknown;
  };
  updatedBy: string;
}

export async function updateWorkflow(
  ctx: MutationCtx,
  args: UpdateWorkflowArgs,
): Promise<null> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error(`Workflow ${args.wfDefinitionId} not found`);
  }

  // Properly merge metadata: existing metadata + updates.metadata + tracking fields
  const mergedMetadata = {
    ...(workflow.metadata as Record<string, unknown>),
    ...(args.updates.metadata as Record<string, unknown>),
    updatedAt: Date.now(),
    updatedBy: args.updatedBy,
  };

  await ctx.db.patch(args.wfDefinitionId, {
    ...args.updates,
    metadata: mergedMetadata,
  });

  return null;
}
