/**
 * Create a new workflow (starts as draft v1)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowConfig } from './types';

export interface CreateWorkflowDraftArgs {
  organizationId: string;
  name: string;
  description?: string;
  category?: string;
  config?: WorkflowConfig;
  createdBy: string;
  autoCreateFirstStep?: boolean;
}

export async function createWorkflowDraft(
  ctx: MutationCtx,
  args: CreateWorkflowDraftArgs,
): Promise<Id<'wfDefinitions'>> {
  // Check if workflow with this name already exists
  const existing = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_and_name', (q) =>
      q.eq('organizationId', args.organizationId).eq('name', args.name),
    )
    .first();

  if (existing) {
    throw new Error(`Workflow with name "${args.name}" already exists`);
  }

  // Create first draft version
  const wfDefinitionId = await ctx.db.insert('wfDefinitions', {
    organizationId: args.organizationId,
    name: args.name,
    description: args.description,
    category: args.category,

    version: 'v1',
    versionNumber: 1,
    status: 'draft',
    workflowType: 'predefined',

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

  // Optionally auto-create the first start step
  if (args.autoCreateFirstStep !== false) {
    await ctx.db.insert('wfStepDefs', {
      organizationId: args.organizationId,
      wfDefinitionId,
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      order: 1,
      nextSteps: {},
      config: {},
      metadata: {},
    });
  }

  return wfDefinitionId;
}
