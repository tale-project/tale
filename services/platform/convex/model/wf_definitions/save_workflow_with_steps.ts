/**
 * Update a draft workflow and replace all of its steps.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { validateWorkflowSteps } from '../../workflow/helpers/validation/validate_workflow_steps';
import type { WorkflowConfig, WorkflowType } from './types';
import type { StepConfig } from '../../workflow/types/nodes';

export interface SaveWorkflowWithStepsArgs {
  organizationId: string;
  workflowId: Id<'wfDefinitions'>;
  workflowConfig: {
    description?: string;
    version?: string;
    workflowType?: WorkflowType;
    config?: WorkflowConfig;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: 'trigger' | 'llm' | 'condition' | 'action' | 'loop';
    order: number;
    config: StepConfig;
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
  validateWorkflowSteps(args.stepsConfig);

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
    config: args.workflowConfig.config ?? existing.config ?? {},
    metadata: {
      ...(existing.metadata || {}),
      updatedAt: Date.now(),
      updatedBy: 'system',
    },
  });

  // Collect all existing step IDs first
  const existingStepIds: Array<Id<'wfStepDefs'>> = [];
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', args.workflowId))) {
    existingStepIds.push(step._id);
  }

  // Delete all existing steps in parallel
  await Promise.all(existingStepIds.map((id) => ctx.db.delete(id)));

  // Insert all new steps in parallel
  const stepIds = await Promise.all(
    args.stepsConfig.map((stepConfig) =>
      ctx.db.insert('wfStepDefs', {
        wfDefinitionId: args.workflowId,
        stepSlug: stepConfig.stepSlug,
        name: stepConfig.name,
        stepType: stepConfig.stepType,
        order: stepConfig.order,
        config: stepConfig.config,
        nextSteps: stepConfig.nextSteps,
        organizationId: args.organizationId,
      }),
    ),
  );

  return {
    workflowId: args.workflowId,
    stepIds,
  };
}
