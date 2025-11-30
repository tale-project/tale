/**
 * Workflow Scheduler - Thin wrappers for scheduler functionality
 *
 * This file contains only thin wrapper functions that call the helper functions.
 * All business logic is in convex/workflow/helpers/scheduler/
 */

import { internalQuery, internalAction } from '../_generated/server';
import { v } from 'convex/values';

// Import all helper functions as a namespace
import * as SchedulerHelpers from './helpers/scheduler';

/**
 * Get all workflows that have schedule triggers
 */
export const getScheduledWorkflows = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await SchedulerHelpers.getScheduledWorkflows(ctx);
  },
});

/**
 * Get the last execution start time (ms since epoch) for a workflow definition
 */
export const getLastExecutionTime = internalQuery({
  args: { wfDefinitionId: v.id('wfDefinitions') },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    return await SchedulerHelpers.getLastExecutionTime(ctx, args);
  },
});

/**
 * Trigger a specific workflow manually
 */
export const triggerWorkflowById = internalAction({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(v.any()),
    triggeredBy: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await SchedulerHelpers.triggerWorkflowById(ctx, args);
  },
});

/**
 * Scan for workflows that need to be triggered based on their schedule
 */
export const scanAndTrigger = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await SchedulerHelpers.scanAndTrigger(ctx);
    return null;
  },
});
