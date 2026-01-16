/**
 * Workflow Node Executors - Thin Convex Action Wrappers
 *
 * This file contains thin Convex internalAction wrappers that call helper functions.
 * Actual business logic is in workflow/helpers/nodes/{node_type}/execute_{node_type}_node.ts
 */

import { internalAction } from '../_generated/server';
import type { Infer } from 'convex/values';
import { v } from 'convex/values';
import type { LLMNodeConfig, StepExecutionResult } from './types';
import {
  triggerNodeConfigValidator,
  llmStepConfigValidator,
} from './types/nodes';

// Import helper functions as namespaces
import * as ActionNodeHelpers from './helpers/nodes/action/execute_action_node';
import * as ConditionNodeHelpers from './helpers/nodes/condition/execute_condition_node';
import * as LoopNodeHelpers from './helpers/nodes/loop/execute_loop_node';
import * as LLMNodeHelpers from './helpers/nodes/llm/execute_llm_node';
import * as TriggerNodeHelpers from './helpers/nodes/trigger/execute_trigger_node';

/** Type for the validated LLM step config (either direct or wrapped) */
type LLMStepConfig = Infer<typeof llmStepConfigValidator>;

/**
 * Normalize LLM config - extract LLMNodeConfig from either shape.
 * The validator accepts both direct LLMNodeConfig and { llmNode: LLMNodeConfig }.
 */
function normalizeLLMConfig(config: LLMStepConfig): LLMNodeConfig {
  if ('llmNode' in config) {
    return config.llmNode;
  }
  return config;
}

// =============================================================================
// VALIDATORS
// =============================================================================

const stepExecutionResultValidator = v.object({
  port: v.string(),
  variables: v.optional(v.object({ loop: v.optional(jsonValueValidator) })),
  output: v.object({
    type: v.string(),
    data: jsonValueValidator,
    meta: v.optional(jsonRecordValidator),
  }),
  error: v.optional(v.string()),
  threadId: v.optional(v.string()),
  approvalTaskId: v.optional(v.string()),
});

// =============================================================================
// ACTION NODE
// =============================================================================

export const executeActionNode = internalAction({
  args: {
    stepDef: v.any(),
    variables: jsonRecordValidator,
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<StepExecutionResult> => {
    return await ActionNodeHelpers.executeActionNode(
      ctx,
      args.stepDef.config,
      args.variables ?? {},
      args.executionId,
    );
  },
});

// =============================================================================
// CONDITION NODE
// =============================================================================

export const executeConditionNode = internalAction({
  args: {
    stepDef: v.object({
      stepSlug: v.string(),
      stepType: v.literal('condition'),
      config: v.any(),
    }),
    variables: jsonRecordValidator,
    executionId: v.union(v.string(), v.id('wfExecutions')),
  },
  returns: stepExecutionResultValidator,
  handler: async (_ctx, args): Promise<StepExecutionResult> => {
    return ConditionNodeHelpers.executeConditionNode(
      args.stepDef.config,
      args.variables,
    );
  },
});

// =============================================================================
// LOOP NODE
// =============================================================================

export const executeLoopNode = internalAction({
  args: {
    stepDef: v.object({
      stepSlug: v.string(),
      stepType: v.literal('loop'),
      config: v.any(),
    }),
    variables: jsonRecordValidator,
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (_ctx, args): Promise<StepExecutionResult> => {
    return await LoopNodeHelpers.executeLoopNode(
      args.stepDef.stepSlug,
      args.stepDef.config,
      args.variables,
      args.executionId,
      args.threadId,
    );
  },
});

// =============================================================================
// LLM NODE
// =============================================================================

export const executeLLMNode = internalAction({
  args: {
    stepDef: v.object({
      stepSlug: v.string(),
      stepType: v.literal('llm'),
      // Accept loose type from caller - validation/normalization happens in handler
      config: v.any(),
      organizationId: v.string(),
    }),
    variables: jsonRecordValidator,
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (ctx, args): Promise<StepExecutionResult> => {
    // Normalize config - extract LLMNodeConfig from either direct or wrapped shape
    // The config is validated/normalized here so callers don't need type assertions
    const llmConfig = normalizeLLMConfig(args.stepDef.config as LLMStepConfig);
    return await LLMNodeHelpers.executeLLMNode(
      ctx,
      llmConfig,
      args.variables,
      args.executionId,
      args.stepDef.organizationId,
      args.threadId,
    );
  },
});

// =============================================================================
// TRIGGER NODE
// =============================================================================

export const executeTriggerNode = internalAction({
  args: {
    stepDef: v.object({
      stepSlug: v.string(),
      stepType: v.literal('trigger'),
      config: triggerNodeConfigValidator,
    }),
    variables: jsonRecordValidator,
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (_ctx, args): Promise<StepExecutionResult> => {
    return await TriggerNodeHelpers.executeTriggerNode(
      args.stepDef.config,
      args.variables,
      args.executionId,
      args.threadId,
    );
  },
});
