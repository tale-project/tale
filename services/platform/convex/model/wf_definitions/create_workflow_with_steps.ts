/**
 * Create a workflow definition and all of its steps in a single operation.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { validateWorkflowSteps } from '../../workflow/helpers/engine/validate_workflow_steps';
import type { WorkflowConfig } from './types';
import { createWorkflowDraft } from './create_workflow_draft';

export interface CreateWorkflowWithStepsArgs {
  organizationId: string;
  workflowConfig: {
    name: string;
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

export interface CreateWorkflowWithStepsResult {
  workflowId: Id<'wfDefinitions'>;
  stepIds: Id<'wfStepDefs'>[];
}

export async function createWorkflowWithSteps(
  ctx: MutationCtx,
  args: CreateWorkflowWithStepsArgs,
): Promise<CreateWorkflowWithStepsResult> {
  // Validate workflow steps configuration before saving
  validateWorkflowSteps(args.stepsConfig as any);

  // Create a new draft workflow, enforcing name uniqueness per organization
  const workflowId: Id<'wfDefinitions'> = await createWorkflowDraft(ctx, {
    organizationId: args.organizationId,
    name: args.workflowConfig.name,
    description: args.workflowConfig.description,
    category: undefined,
    config: (args.workflowConfig.config as WorkflowConfig | undefined) || {},
    createdBy: 'system',
    autoCreateFirstStep: false,
  });

  const stepIds: Id<'wfStepDefs'>[] = [];
  for (const stepConfig of args.stepsConfig) {
    const stepId = await ctx.db.insert('wfStepDefs', {
      wfDefinitionId: workflowId,
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
    workflowId,
    stepIds,
  };
}
