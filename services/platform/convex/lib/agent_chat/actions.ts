'use node';

/**
 * Generic Agent Chat Action
 *
 * This action handles agent response generation for all agent types.
 * Configuration is passed as parameters - no imports from agents/.
 * Hooks are called via FunctionHandle for full decoupling.
 */

import { v } from 'convex/values';
import type { FunctionHandle } from 'convex/server';
import { Agent } from '@convex-dev/agent';
import { internalAction } from '../../_generated/server';
import { components } from '../../_generated/api';
import { generateAgentResponse } from '../agent_response';
import { createAgentConfig } from '../create_agent_config';
import { classifyError, NonRetryableError } from '../error_classification';
import type { AgentType } from '../context_management/constants';
import type { GenerateResponseHooks, BeforeContextResult, BeforeGenerateResult } from '../agent_response/types';
import type { ToolName } from '../../agent_tools/tool_registry';

const serializableAgentConfigValidator = v.object({
  name: v.string(),
  instructions: v.string(),
  convexToolNames: v.optional(v.array(v.string())),
  useFastModel: v.optional(v.boolean()),
  model: v.optional(v.string()),
  maxSteps: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  temperature: v.optional(v.number()),
  outputFormat: v.optional(v.union(v.literal('text'), v.literal('json'))),
  enableVectorSearch: v.optional(v.boolean()),
});

const hooksConfigValidator = v.object({
  beforeContext: v.optional(v.string()),
  beforeGenerate: v.optional(v.string()),
  afterGenerate: v.optional(v.string()),
  onError: v.optional(v.string()),
});

export const runAgentGeneration = internalAction({
  args: {
    agentType: v.string(),
    agentConfig: serializableAgentConfigValidator,
    model: v.string(),
    provider: v.string(),
    debugTag: v.string(),
    enableStreaming: v.optional(v.boolean()),
    hooks: v.optional(hooksConfigValidator),
    threadId: v.string(),
    organizationId: v.string(),
    userId: v.optional(v.string()),
    taskDescription: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    parentThreadId: v.optional(v.string()),
    agentOptions: v.optional(v.any()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    streamId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    maxSteps: v.optional(v.number()),
    userTeamIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const {
      agentType: agentTypeStr,
      agentConfig,
      model,
      provider,
      debugTag,
      enableStreaming,
      hooks: hooksConfig,
      threadId,
      organizationId,
      userId,
      taskDescription,
      additionalContext,
      parentThreadId,
      agentOptions,
      attachments,
      streamId,
      promptMessageId,
      maxSteps,
      userTeamIds,
    } = args;

    const agentType = agentTypeStr as AgentType;

    // Create agent factory function from serializable config
    const createAgent = (options?: Record<string, unknown>) => {
      const config = createAgentConfig({
        name: agentConfig.name,
        instructions: agentConfig.instructions,
        convexToolNames: agentConfig.convexToolNames as ToolName[] | undefined,
        useFastModel: agentConfig.useFastModel,
        model: agentConfig.model,
        maxSteps: options?.maxSteps as number | undefined ?? agentConfig.maxSteps,
        maxTokens: agentConfig.maxTokens,
        temperature: agentConfig.temperature,
        outputFormat: agentConfig.outputFormat,
        enableVectorSearch: agentConfig.enableVectorSearch,
      });
      return new Agent(components.agent, config);
    };

    // Build hooks object from FunctionHandle strings
    const hooks: GenerateResponseHooks | undefined = hooksConfig
      ? buildHooksFromConfig(hooksConfig)
      : undefined;

    try {
      const result = await generateAgentResponse(
        {
          agentType,
          createAgent,
          model,
          provider,
          debugTag,
          enableStreaming,
          hooks,
          convexToolNames: agentConfig.convexToolNames,
        },
        {
          ctx,
          threadId,
          organizationId,
          userId,
          taskDescription,
          additionalContext,
          parentThreadId,
          agentOptions,
          attachments,
          streamId,
          promptMessageId,
          maxSteps,
          userTeamIds,
        },
      );

      // Validate response
      if (!result.text?.trim()) {
        throw new Error(
          `Agent returned empty response: ${JSON.stringify({
            model: result.model,
            usage: result.usage,
          })}`,
        );
      }

      return result;
    } catch (error) {
      // Log full error details for debugging
      const err = error as Record<string, unknown>;
      console.error('[runAgentGeneration] Full error details:', {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        status: err?.status,
        statusCode: err?.statusCode,
        cause: err?.cause,
        stack: err?.stack,
        error: JSON.stringify(error, Object.getOwnPropertyNames(error as object), 2),
      });

      // Classify and wrap error for retry decisions
      const classification = classifyError(error);
      throw new NonRetryableError(
        `${classification.description}: ${JSON.stringify({
          message: err?.message,
          code: err?.code,
          status: err?.status,
          cause: err?.cause,
        })}`,
        error,
        classification.reason,
      );
    }
  },
});

/**
 * Build hooks object from FunctionHandle configuration.
 * Converts string handles to callable functions.
 */
function buildHooksFromConfig(hooksConfig: {
  beforeContext?: string;
  beforeGenerate?: string;
  afterGenerate?: string;
  onError?: string;
}): GenerateResponseHooks {
  const hooks: GenerateResponseHooks = {};

  if (hooksConfig.beforeContext) {
    // Cast the FunctionHandle string back to a FunctionHandle type for ctx.runAction
    const handle = hooksConfig.beforeContext as FunctionHandle<'action'>;
    hooks.beforeContext = async (ctx, args) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        userId: args.userId,
        taskDescription: args.taskDescription,
        organizationId: args.organizationId,
        userTeamIds: args.userTeamIds,
      });
      return result as BeforeContextResult;
    };
  }

  if (hooksConfig.beforeGenerate) {
    const handle = hooksConfig.beforeGenerate as FunctionHandle<'action'>;
    hooks.beforeGenerate = async (ctx, args, context, hookData) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        taskDescription: args.taskDescription,
        attachments: args.attachments,
        contextMessagesTokens: context.stats.totalTokens,
        existingSummary: hookData?.contextSummary,
      });
      return result as BeforeGenerateResult;
    };
  }

  if (hooksConfig.afterGenerate) {
    const handle = hooksConfig.afterGenerate as FunctionHandle<'action'>;
    hooks.afterGenerate = async (ctx, args, result, _hookData) => {
      await ctx.runAction(handle, {
        threadId: args.threadId,
        result: {
          text: result.text,
          usage: result.usage,
          durationMs: result.durationMs,
        },
      });
    };
  }

  if (hooksConfig.onError) {
    const handle = hooksConfig.onError as FunctionHandle<'action'>;
    hooks.onError = async (ctx, args, error) => {
      const err = error as Record<string, unknown>;
      await ctx.runAction(handle, {
        threadId: args.threadId,
        errorName: err?.name as string | undefined,
        errorMessage: err?.message as string | undefined,
        errorStatus: err?.status as number | string | undefined,
        errorType: err?.type as string | undefined,
        errorCode: err?.code as string | undefined,
      });
    };
  }

  return hooks;
}
