/**
 * Create a workflow definition and all of its steps in a single operation.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { validateWorkflowSteps } from '../../workflow/helpers/validation/validate_workflow_steps';
import type { WorkflowConfig, WorkflowType } from './types';
import type { StepConfig } from '../../workflow/types/nodes';
import { createWorkflowDraft } from './create_workflow_draft';

export interface CreateWorkflowWithStepsArgs {
  organizationId: string;
  workflowConfig: {
    name: string;
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

export interface CreateWorkflowWithStepsResult {
  workflowId: Id<'wfDefinitions'>;
  stepIds: Id<'wfStepDefs'>[];
}

export async function createWorkflowWithSteps(
  ctx: MutationCtx,
  args: CreateWorkflowWithStepsArgs,
): Promise<CreateWorkflowWithStepsResult> {
  // Validate workflow steps configuration before saving
  validateWorkflowSteps(args.stepsConfig);

  // Create a new draft workflow, enforcing name uniqueness per organization
  const workflowId: Id<'wfDefinitions'> = await createWorkflowDraft(ctx, {
    organizationId: args.organizationId,
    name: args.workflowConfig.name,
    description: args.workflowConfig.description,
    category: undefined,
    config: args.workflowConfig.config ?? {},
    createdBy: 'system',
    autoCreateFirstStep: false,
  });

  // Insert all steps in parallel
  const stepIds = await Promise.all(
    args.stepsConfig.map((stepConfig) =>
      ctx.db.insert('wfStepDefs', {
        wfDefinitionId: workflowId,
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
    workflowId,
    stepIds,
  };
}
