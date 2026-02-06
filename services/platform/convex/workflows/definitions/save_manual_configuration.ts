/**
 * Save a manually authored workflow configuration and its steps.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { StepConfig } from '../../workflow_engine/types/nodes';
import type { WorkflowConfig } from './types';

export interface SaveManualConfigurationArgs {
  organizationId: string;
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: 'predefined';
    config?: WorkflowConfig;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: 'start' | 'trigger' | 'llm' | 'condition' | 'action' | 'loop';
    order: number;
    config: StepConfig;
    nextSteps: Record<string, string>;
  }>;
}

export interface SaveManualConfigurationResult {
  workflowId: Id<'wfDefinitions'>;
  stepIds: Id<'wfStepDefs'>[];
}

export async function saveManualConfiguration(
  ctx: MutationCtx,
  args: SaveManualConfigurationArgs,
): Promise<SaveManualConfigurationResult> {
  // Create the workflow first
  const workflowId: Id<'wfDefinitions'> = await ctx.db.insert('wfDefinitions', {
    organizationId: args.organizationId,
    name: args.workflowConfig.name,
    description: args.workflowConfig.description,
    version: args.workflowConfig.version ?? 'v1',
    versionNumber: 1,
    status: 'draft',
    workflowType: args.workflowConfig.workflowType ?? 'predefined',
    config: args.workflowConfig.config ?? {},
    metadata: {
      createdAt: Date.now(),
      createdBy: 'user', // TODO: get from auth context
    },
  });

  // For the first version, rootVersionId is the version itself
  await ctx.db.patch(workflowId, {
    rootVersionId: workflowId,
  });

  // Create all steps in parallel
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

