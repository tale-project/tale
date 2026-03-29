'use node';

/**
 * Start a workflow from a file-based JSON definition.
 *
 * This is the action→mutation two-phase pattern:
 * 1. Action reads the workflow JSON file from disk
 * 2. Action calls an internal mutation to create the execution record and start the engine
 *
 * The action context is required because file reads are only possible in actions.
 */

import { v } from 'convex/values';

import type { Id } from '../../../_generated/dataModel';

import { internal } from '../../../_generated/api';
import { internalAction } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import { jsonValueValidator } from '../../../lib/validators/json';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export const startWorkflowFromFile = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    workflowSlug: v.string(),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
    userId: v.optional(v.string()),
  },
  returns: v.union(v.id('wfExecutions'), v.null()),
  handler: async (ctx, args): Promise<Id<'wfExecutions'> | null> => {
    debugLog('startWorkflowFromFile Reading workflow file', {
      orgSlug: args.orgSlug,
      workflowSlug: args.workflowSlug,
    });

    // Step 1: Read workflow JSON from filesystem
    const result = await ctx.runAction(
      internal.workflows.file_actions.readWorkflowForExecution,
      {
        orgSlug: args.orgSlug,
        workflowSlug: args.workflowSlug,
      },
    );

    if (!result.ok) {
      console.error(
        '[startWorkflowFromFile] Failed to read workflow file',
        result,
      );
      return null;
    }

    const config = result.config;

    // Step 2: Check if workflow is installed and enabled
    if (!config.installed) {
      debugLog('startWorkflowFromFile Workflow is not installed, skipping', {
        workflowSlug: args.workflowSlug,
      });
      return null;
    }

    if (!config.enabled) {
      debugLog('startWorkflowFromFile Workflow is disabled, skipping', {
        workflowSlug: args.workflowSlug,
      });
      return null;
    }

    debugLog('startWorkflowFromFile Starting execution', {
      workflowName: config.name,
      workflowSlug: args.workflowSlug,
    });

    // Step 3: Call mutation to create execution and start the engine
    const executionId: Id<'wfExecutions'> = await ctx.runMutation(
      internal.wf_executions.internal_mutations.startWorkflowFromFileConfig,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        workflowConfig: config,
        input: args.input,
        triggeredBy: args.triggeredBy,
        triggerData: args.triggerData,
        userId: args.userId,
      },
    );

    debugLog('startWorkflowFromFile Execution started', {
      executionId,
      workflowSlug: args.workflowSlug,
    });

    return executionId;
  },
});
