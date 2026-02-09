/**
 * Update draft version (only drafts can be modified)
 */

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { WorkflowDefinition, WorkflowConfig } from './types';

export interface UpdateDraftArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  name?: string;
  description?: string;
  category?: string;
  config?: WorkflowConfig;
  updatedBy: string;
}

export async function updateDraft(
  ctx: MutationCtx,
  args: UpdateDraftArgs,
): Promise<null> {
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  // Only drafts can be modified
  if (workflow.status !== 'draft') {
    throw new Error(
      'Only draft workflows can be modified. Active/Archived workflows are immutable.',
    );
  }

  // Update draft
  const updates: Partial<WorkflowDefinition> = {};
  if (args.name !== undefined) updates.name = args.name;
  if (args.description !== undefined) updates.description = args.description;
  if (args.category !== undefined) updates.category = args.category;
  if (args.config !== undefined) updates.config = args.config;

  updates.metadata = {
    ...workflow.metadata,
    updatedAt: Date.now(),
    updatedBy: args.updatedBy,
  };

  await ctx.db.patch(args.wfDefinitionId, updates);

  return null;
}
