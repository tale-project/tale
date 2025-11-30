/**
 * Create execution record
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
// Inline serialization removed. Variables are initialized empty at creation; actual values set from actions.
import { snakeCase } from 'lodash';
import type { CreateExecutionArgs, ExecutionVariables } from './types';

export async function createExecution(
  ctx: MutationCtx,
  args: CreateExecutionArgs,
): Promise<Id<'wfExecutions'>> {
  // Initialize variables with input data and include organizationId for action steps
  const variables: ExecutionVariables = {
    ...(typeof args.input === 'object' && args.input !== null
      ? args.input
      : {}),
    organizationId: args.organizationId,
  };

  // Generate workflowSlug from workflow name using snake_case
  // This creates a stable identifier for tracking processed entities
  const workflowSlug = args.workflowName
    ? snakeCase(args.workflowName)
    : undefined;

  console.log('[createExecution] Creating execution', {
    workflowName: args.workflowName,
    workflowSlug,
    organizationId: args.organizationId,
  });

  // Initialize with empty variables; they will be set via actions using storage-backed serialization
  const serialized = JSON.stringify({});

  return await ctx.db.insert('wfExecutions', {
    organizationId: args.organizationId,
    wfDefinitionId: args.wfDefinitionId,
    status: 'running',
    currentStepSlug: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    variables: serialized,
    // No variablesStorageId at creation time (large payloads should be set from an action later)
    input: args.input,
    triggeredBy: args.triggeredBy,
    triggerData: args.triggerData,
    // Store potentially deeply nested configs as JSON strings to avoid Convex nesting limits
    workflowConfig: args.workflowConfig
      ? JSON.stringify(args.workflowConfig)
      : JSON.stringify({}),
    stepsConfig: args.stepsConfig
      ? JSON.stringify(args.stepsConfig)
      : JSON.stringify({}),
    workflowSlug,
  });
}
