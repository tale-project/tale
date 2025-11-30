/**
 * Create new workflow (DEPRECATED - use createWorkflowDraft instead)
 *
 * This function is kept for backward compatibility but should not be used for new code.
 * Use createWorkflowDraft which includes proper version management.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowConfig } from './types';

export interface CreateWorkflowArgs {
  organizationId: string;
  name: string;
  description?: string;
  workflowType?: 'predefined';
  config?: WorkflowConfig;
  createdBy: string;
  autoCreateFirstStep?: boolean;
}

export async function createWorkflow(
  ctx: MutationCtx,
  args: CreateWorkflowArgs,
): Promise<Id<'wfDefinitions'>> {
  const wfDefinitionId = await ctx.db.insert('wfDefinitions', {
    organizationId: args.organizationId,
    name: args.name,
    description: args.description,

    version: 'v1',
    versionNumber: 1,
    status: 'draft',
    workflowType: args.workflowType ?? 'predefined',

    config: args.config,
    metadata: {
      createdAt: Date.now(),
      createdBy: args.createdBy,
    },
  });

  // For the first version, rootVersionId is the version itself
  await ctx.db.patch(wfDefinitionId, {
    rootVersionId: wfDefinitionId,
  });

  // Optionally auto-create the first trigger step at order 1
  if (args.autoCreateFirstStep !== false) {
    await ctx.db.insert('wfStepDefs', {
      organizationId: args.organizationId,
      wfDefinitionId,
      stepSlug: 'start',
      name: 'Start',
      stepType: 'trigger',
      order: 1,
      nextSteps: {},
      config: { type: 'manual' },
      metadata: {},
    });
  }

  return wfDefinitionId;
}
