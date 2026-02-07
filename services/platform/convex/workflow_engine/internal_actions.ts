import { Infer, v } from 'convex/values';
import { internalAction } from '../_generated/server';
import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import type { LLMNodeConfig } from './types';
import {
  triggerNodeConfigValidator,
  llmStepConfigValidator,
  actionNodeConfigValidator,
  conditionNodeConfigValidator,
  loopNodeConfigValidator,
} from './types/nodes';
import * as ActionNodeHelpers from './helpers/nodes/action/execute_action_node';
import * as ConditionNodeHelpers from './helpers/nodes/condition/execute_condition_node';
import * as EngineHelpers from './helpers/engine';
import * as LLMNodeHelpers from './helpers/nodes/llm/execute_llm_node';
import * as LoopNodeHelpers from './helpers/nodes/loop/execute_loop_node';
import * as SchedulerHelpers from './helpers/scheduler';
import * as TriggerNodeHelpers from './helpers/nodes/trigger/execute_trigger_node';

type LLMStepConfig = Infer<typeof llmStepConfigValidator>;

function normalizeLLMConfig(config: LLMStepConfig): LLMNodeConfig {
  if ('llmNode' in config) {
    return config.llmNode;
  }
  return config;
}

const stepExecutionResultValidator = v.object({
  port: v.string(),
  variables: v.optional(jsonRecordValidator),
  output: v.object({
    type: v.string(),
    data: jsonValueValidator,
    meta: v.optional(jsonRecordValidator),
  }),
  error: v.optional(v.string()),
  threadId: v.optional(v.string()),
  approvalTaskId: v.optional(v.string()),
});

export const executeStep = internalAction({
  args: {
    organizationId: v.string(),
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

export const serializeAndCompleteExecution = internalAction({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await EngineHelpers.handleSerializeAndCompleteExecution(ctx, args);
  },
});

export const scanAndTrigger = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await SchedulerHelpers.scanAndTrigger(ctx);
    return null;
  },
});

export const triggerWorkflowById = internalAction({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await SchedulerHelpers.triggerWorkflowById(ctx, args);
  },
});

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
