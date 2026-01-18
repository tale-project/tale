/**
 * Start workflow handler - business logic for starting workflows
 */

import type { MutationCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import { snakeCase } from 'lodash';
import type { WorkflowManager } from '@convex-dev/workflow';
import { executeWorkflowStart } from './execute_workflow_start';
import { Infer } from 'convex/values';
import { jsonValueValidator } from '../../../../lib/shared/schemas/utils/json-value';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

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
  // Validate database workflow definition
  const wfDefinition = await ctx.db.get(args.wfDefinitionId);
  if (!wfDefinition) {
    throw new Error('Workflow definition not found');
  }

  // Validate that database-backed workflows have at least one step defined
  const firstStep = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .first();

  if (firstStep === null) {
    throw new Error('No steps defined for workflow');
  }

  const workflowName = wfDefinition.name;

  // Generate workflowSlug from workflow name
  const workflowSlug = snakeCase(workflowName);

  // Get rootWfDefinitionId: use wfDefinition's rootVersionId, or fall back to its own _id
  const rootWfDefinitionId = wfDefinition.rootVersionId ?? wfDefinition._id;

  debugLog('startWorkflow Creating execution', {
    workflowName,
    workflowSlug,
    rootWfDefinitionId,
  });

  // Pre-create execution record with pending status
  const executionId: Id<'wfExecutions'> = await ctx.db.insert('wfExecutions', {
    organizationId: args.organizationId,
    wfDefinitionId: args.wfDefinitionId,
    rootWfDefinitionId,
    status: 'pending',
    currentStepSlug: '',
    input: (args.input || {}) as ConvexJsonValue,
    variables: '{}',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    triggeredBy: args.triggeredBy,
    triggerData: args.triggerData as ConvexJsonValue,
    metadata: '{}',
    workflowSlug,
  });

  // Start workflow via shared helper to avoid extra nested mutations
  debugLog('startWorkflow Starting workflow via helper', {
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

  debugLog('startWorkflow Workflow scheduled successfully', {
    executionId,
    workflowName,
  });

  return executionId;
}
