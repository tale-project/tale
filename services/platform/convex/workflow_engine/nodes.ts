/**
 * Workflow Node Executors - Thin Convex Action Wrappers
 *
 * This file contains thin Convex internalAction wrappers that call helper functions.
 * Actual business logic is in workflow/helpers/nodes/{node_type}/execute_{node_type}_node.ts
 */

import { internalAction } from '../_generated/server';
import { Infer, v } from 'convex/values';
import type { LLMNodeConfig } from './types';
import {
  triggerNodeConfigValidator,
  llmStepConfigValidator,
  actionNodeConfigValidator,
  conditionNodeConfigValidator,
  loopNodeConfigValidator,
} from './types/nodes';
import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';

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
    stepDef: v.object({
      stepSlug: v.string(),
      stepType: v.literal('action'),
      config: actionNodeConfigValidator,
    }),
    variables: v.any(),
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (ctx, args) => {
    const result = await ActionNodeHelpers.executeActionNode(
      ctx,
      args.stepDef.config,
      args.variables ?? {},
      args.executionId,
    );
    return result as Infer<typeof stepExecutionResultValidator>;
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
      config: conditionNodeConfigValidator,
    }),
    variables: v.any(),
    executionId: v.union(v.string(), v.id('wfExecutions')),
  },
  returns: stepExecutionResultValidator,
  handler: async (_ctx, args) => {
    const result = ConditionNodeHelpers.executeConditionNode(
      args.stepDef.config,
      args.variables,
    );
    return result as Infer<typeof stepExecutionResultValidator>;
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
      config: loopNodeConfigValidator,
    }),
    variables: v.any(),
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (_ctx, args) => {
    const result = await LoopNodeHelpers.executeLoopNode(
      args.stepDef.stepSlug,
      args.stepDef.config,
      args.variables,
      args.executionId,
      args.threadId,
    );
    return result as Infer<typeof stepExecutionResultValidator>;
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
      config: llmStepConfigValidator,
      organizationId: v.string(),
    }),
    variables: v.any(),
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (ctx, args) => {
    // Normalize config - extract LLMNodeConfig from either direct or wrapped shape
    // The config is validated/normalized here so callers don't need type assertions
    const llmConfig = normalizeLLMConfig(args.stepDef.config as LLMStepConfig);
    const result = await LLMNodeHelpers.executeLLMNode(
      ctx,
      llmConfig,
      args.variables,
      args.executionId,
      args.stepDef.organizationId,
      args.threadId,
    );
    return result as Infer<typeof stepExecutionResultValidator>;
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
    variables: v.any(),
    executionId: v.union(v.string(), v.id('wfExecutions')),
    threadId: v.optional(v.string()),
  },
  returns: stepExecutionResultValidator,
  handler: async (_ctx, args) => {
    const result = await TriggerNodeHelpers.executeTriggerNode(
      args.stepDef.config,
      args.variables,
      args.executionId,
      args.threadId,
    );
    return result as Infer<typeof stepExecutionResultValidator>;
  },
});
