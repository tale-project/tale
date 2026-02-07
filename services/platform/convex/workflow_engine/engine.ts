/**
 * Workflow Engine - Convex Function Definitions
 *
 * This file contains all Convex function definitions for the workflow engine.
 * All business logic has been moved to workflow/helpers/engine/.
 * These are thin wrappers that call the helper functions.
 */

import {
	internalMutation,
	internalAction,
} from '../_generated/server';
import { v } from 'convex/values';
import { vWorkflowId } from '@convex-dev/workflow';
import { WorkflowManager } from '@convex-dev/workflow';
import { components } from '../_generated/api';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

import * as EngineHelpers from './helpers/engine';

// =============================================================================
// WORKFLOW MANAGER
// =============================================================================

// Type assertion to work around build-time type mismatch
// The types are compatible at runtime, but TypeScript's strict checking
// during build may fail due to generated type differences
export const workflowManager = new WorkflowManager(components.workflow);

// =============================================================================
// DYNAMIC WORKFLOW DEFINITION
// =============================================================================

export const dynamicWorkflow = workflowManager.define({
	args: {
		organizationId: v.string(),
		executionId: v.id('wfExecutions'),
		workflowDefinition: jsonValueValidator,
		steps: v.array(jsonValueValidator),
		input: v.optional(jsonValueValidator),
		triggeredBy: v.string(),
		triggerData: v.optional(jsonValueValidator),
		resumeFromStepSlug: v.optional(v.string()),
		resumeVariables: v.optional(jsonValueValidator),
		threadId: v.optional(v.string()),
	},
	handler: async (step, args): Promise<void> => {
		await EngineHelpers.handleDynamicWorkflow(step, args);
	},
});

// =============================================================================
// WORKFLOW COMPLETION HOOK
// =============================================================================

/**
 * Hook called when a workflow completes execution.
 * Mirrors final status to wfExecutions table.
 */
export const onWorkflowComplete = internalMutation({
	args: {
		workflowId: vWorkflowId,
		context: jsonValueValidator,
		result: jsonValueValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await EngineHelpers.handleWorkflowComplete(ctx, args);
		return null;
	},
});

// =============================================================================
// CLEANUP COMPONENT WORKFLOW
// =============================================================================

/**
 * Cleanup component workflow after a delay.
 *
 * This is used when deleting workflow definitions: we cancel in-progress
 * component workflows immediately, then schedule this mutation via
 * ctx.scheduler.runAfter to clean up their journal/state once the
 * workflow engine has finished its own cancellation/onComplete logic.
 */
export const cleanupComponentWorkflow = internalMutation({
  args: {
    workflowId: vWorkflowId,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await EngineHelpers.cleanupComponentWorkflow(
      workflowManager,
      ctx,
      args.workflowId,
    );
    return null;
  },
});

// =============================================================================
// STEP EXECUTION
// =============================================================================

/**
 * Execute a single workflow step
 */
export const executeStep = internalAction({
  args: {
    // Essential identifiers
    organizationId: v.string(), // Better Auth organization ID
    executionId: v.string(),
    stepSlug: v.string(),
    stepType: v.union(
      v.literal('trigger'),
      v.literal('llm'),
      v.literal('condition'),
      v.literal('action'),
      v.literal('loop'),
    ),
    stepName: v.optional(v.string()),
    threadId: v.optional(v.string()),
    initialInput: v.optional(jsonValueValidator),
    resumeVariables: v.optional(jsonValueValidator),
  },
  returns: v.object({
    port: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await EngineHelpers.handleExecuteStep(ctx, args);
  },
});

/**
 * Serialize output and mark execution as completed.
 *
 * This action handles large output by storing it in Convex storage
 * before calling the completion mutation. This is necessary because
 * mutations cannot use ctx.storage.store().
 */
export const serializeAndCompleteExecution = internalAction({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await EngineHelpers.handleSerializeAndCompleteExecution(ctx, args);
  },
});
