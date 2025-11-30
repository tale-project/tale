/**
 * Start workflow handler - business logic for starting workflows
 */

import type { MutationCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import { snakeCase } from 'lodash';
import type { WorkflowManager } from '@convex-dev/workflow';
import { executeWorkflowStart } from './execute_workflow_start';

export type StartWorkflowArgs = {
  organizationId: string;
  wfDefinitionId: Id<'wfDefinitions'>;
  input?: unknown;
  triggeredBy: string;
  triggerData?: unknown;
};

export async function handleStartWorkflow(
  ctx: MutationCtx,
  args: StartWorkflowArgs,
  workflowManager: WorkflowManager,
): Promise<Id<'wfExecutions'>> {
  // Validate database workflow
  const workflow = await ctx.db.get(args.wfDefinitionId);
  if (!workflow) {
    throw new Error('Workflow definition not found');
  }

  // Validate that database-backed workflows have at least one step defined
  const steps = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .collect();

  if (steps.length === 0) {
    throw new Error('No steps defined for workflow');
  }

  const workflowName = workflow.name;

  // Generate workflowSlug from workflow name
  const workflowSlug = snakeCase(workflowName);

  console.log('[startWorkflow] Creating execution', {
    workflowName,
    workflowSlug,
  });

  // Pre-create execution record with pending status
  const executionId: Id<'wfExecutions'> = await ctx.db.insert('wfExecutions', {
    organizationId: args.organizationId,
    wfDefinitionId: args.wfDefinitionId,
    status: 'pending',
    currentStepSlug: '',
    input: args.input || {},
    variables: '{}',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    triggeredBy: args.triggeredBy,
    triggerData: args.triggerData,
    metadata: '{}',
    workflowSlug,
  });

  // Start workflow via shared helper to avoid extra nested mutations
  console.log('[startWorkflow] Starting workflow via helper', {
    executionId,
    wfDefinitionId: args.wfDefinitionId,
  });

  await executeWorkflowStart(ctx, {
    executionId,
    organizationId: args.organizationId,
    wfDefinitionId: args.wfDefinitionId,
    input: args.input || {},
    triggeredBy: args.triggeredBy,
    triggerData: args.triggerData,
    workflowManager,
  });

  console.log('[startWorkflow] Workflow scheduled successfully', {
    executionId,
    workflowName,
  });

  return executionId;
}
