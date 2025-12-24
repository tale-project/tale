/**
 * Update a draft workflow and replace all of its steps.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { validateWorkflowSteps } from '../../workflow/helpers/validation/validate_workflow_steps';
import type { WorkflowConfig } from './types';

export interface SaveWorkflowWithStepsArgs {
  organizationId: string;
  workflowId: Id<'wfDefinitions'>;
  workflowConfig: {
    description?: string;
    version?: string;
    workflowType?: 'predefined';
    config?: WorkflowConfig | unknown;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: 'trigger' | 'llm' | 'condition' | 'action' | 'loop';
    order: number;
    config: unknown;
    nextSteps: Record<string, string>;
  }>;
}

export interface SaveWorkflowWithStepsResult {
  workflowId: Id<'wfDefinitions'>;
  stepIds: Id<'wfStepDefs'>[];
}

export async function saveWorkflowWithSteps(
  ctx: MutationCtx,
  args: SaveWorkflowWithStepsArgs,
): Promise<SaveWorkflowWithStepsResult> {
  // Validate steps first
  validateWorkflowSteps(args.stepsConfig as any);

  const existing = await ctx.db.get(args.workflowId);
  if (!existing) {
    throw new Error('Workflow not found');
  }

  if (existing.organizationId !== args.organizationId) {
    throw new Error('Workflow does not belong to this organization');
  }

  if (existing.status !== 'draft') {
    throw new Error('Cannot modify a non-draft workflow');
  }

  // Update workflow config/metadata
  await ctx.db.patch(args.workflowId, {
    description: args.workflowConfig.description ?? existing.description,
    version: args.workflowConfig.version ?? existing.version,
    workflowType: args.workflowConfig.workflowType ?? existing.workflowType,
    config:
      (args.workflowConfig.config as WorkflowConfig | undefined) ||
      (existing.config as WorkflowConfig | undefined) ||
      {},
    metadata: {
      ...(existing.metadata || {}),
      updatedAt: Date.now(),
      updatedBy: 'system',
    },
  });

  // Delete all existing steps for this workflow
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', args.workflowId))) {
    await ctx.db.delete(step._id);
  }

  // Recreate steps
  const stepIds: Id<'wfStepDefs'>[] = [];
  for (const stepConfig of args.stepsConfig) {
    const stepId: Id<'wfStepDefs'> = await ctx.db.insert('wfStepDefs', {
      wfDefinitionId: args.workflowId,
      stepSlug: stepConfig.stepSlug,
      name: stepConfig.name,
      stepType: stepConfig.stepType,
      order: stepConfig.order,
      config: stepConfig.config as any,
      nextSteps: stepConfig.nextSteps,
      organizationId: args.organizationId,
    });
    stepIds.push(stepId);
  }

  return {
    workflowId: args.workflowId,
    stepIds,
  };
}
