/**
 * Workflow Engine - Convex Function Definitions
 *
 * This file contains all Convex function definitions for the workflow engine.
 * All business logic has been moved to workflow/helpers/engine/.
 * These are thin wrappers that call the helper functions.
 */

import {
  mutation,
  internalMutation,
  internalAction,
} from '../_generated/server';
import { v } from 'convex/values';
import { vWorkflowId } from '@convex-dev/workflow';
import { WorkflowManager } from '@convex-dev/workflow';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

// Import all helper functions as a namespace
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
    workflowDefinition: v.any(),
    steps: v.array(v.any()),
    input: v.optional(v.any()),
    triggeredBy: v.string(),
    triggerData: v.optional(v.any()),
    resumeFromStepSlug: v.optional(v.string()),
    resumeVariables: v.optional(v.any()),
    threadId: v.optional(v.string()), // Shared thread for agent orchestration workflows
  },
  handler: async (step, args): Promise<void> => {
    await EngineHelpers.handleDynamicWorkflow(step, args);
  },
});

// =============================================================================
// START WORKFLOW
// =============================================================================

/**
 * Start workflow execution with component engine (async mode)
 *
 * This is the unified entry point for all workflow executions.
 * It starts database-backed workflows by definition ID.
 *
 * The workflow is scheduled to start immediately (0ms delay) but executes
 * in a separate transaction to break the mutation call chain and prevent
 * deep nesting in the mutation response logLines.
 */
export const startWorkflow = mutation({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(v.any()),
    triggeredBy: v.string(),
    triggerData: v.optional(v.any()),
  },
  returns: v.id('wfExecutions'),
  handler: async (ctx, args): Promise<Id<'wfExecutions'>> => {
    return await EngineHelpers.handleStartWorkflow(ctx, args, workflowManager);
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
    context: v.any(),
    result: v.any(),
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
    initialInput: v.optional(v.any()),
    resumeVariables: v.optional(v.any()),
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
 * Mark execution as completed
 */
export const markExecutionCompleted = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await EngineHelpers.handleMarkExecutionCompleted(ctx, args);
  },
});
