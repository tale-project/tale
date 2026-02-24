/**
 * Update workflow
 */

import type { WorkflowStatus } from '../../../lib/shared/schemas/wf_definitions';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { WorkflowConfig } from './types';

export interface UpdateWorkflowArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  updates: {
    name?: string;
    description?: string;
    version?: string;
    status?: WorkflowStatus;
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
    ...workflow.metadata,
    ...(typeof args.updates.metadata === 'object' &&
    args.updates.metadata !== null &&
    !Array.isArray(args.updates.metadata)
      ? args.updates.metadata
      : {}),
    updatedAt: Date.now(),
    updatedBy: args.updatedBy,
  };

  await ctx.db.patch(args.wfDefinitionId, {
    ...args.updates,
    metadata: mergedMetadata,
  });

  return null;
}
