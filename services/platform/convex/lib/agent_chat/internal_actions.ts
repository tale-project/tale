'use node';

import type { FunctionHandle } from 'convex/server';

import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';

import type { ToolName } from '../../agent_tools/tool_registry';
import type {
  GenerateResponseHooks,
  BeforeContextResult,
  BeforeGenerateResult,
} from '../agent_response/types';
import type { AgentType } from '../context_management/constants';

import { isRecord, getString, getNumber } from '../../../lib/utils/type-guards';
import { components } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { createBoundIntegrationTool } from '../../agent_tools/integrations/create_bound_integration_tool';
import { fetchOperationsSummary } from '../../agent_tools/integrations/fetch_operations_summary';
import { generateAgentResponse } from '../agent_response';
import { createAgentConfig } from '../create_agent_config';
import { createDebugLog } from '../debug_log';
import { classifyError, NonRetryableError } from '../error_classification';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[runAgentGeneration]');

const serializableAgentConfigValidator = v.object({
  name: v.string(),
  instructions: v.string(),
  convexToolNames: v.optional(v.array(v.string())),
  integrationBindings: v.optional(v.array(v.string())),
  useFastModel: v.optional(v.boolean()),
  model: v.optional(v.string()),
  maxSteps: v.optional(v.number()),
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
    promptMessage: v.string(),
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
    const actionStartTime = Date.now();
    debugLog('ACTION_START', {
      threadId: args.threadId,
      timestamp: new Date(actionStartTime).toISOString(),
    });

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
      promptMessage,
      additionalContext,
      parentThreadId,
      agentOptions,
      attachments,
      streamId,
      promptMessageId,
      maxSteps,
      userTeamIds,
    } = args;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const agentType = agentTypeStr as AgentType;

    // Build bound integration tools eagerly (before synchronous createAgent closure)
    let integrationExtraTools: Record<string, unknown> | undefined;
    if (agentConfig.integrationBindings?.length) {
      integrationExtraTools = {};
      for (const name of agentConfig.integrationBindings) {
        const summary = await fetchOperationsSummary(ctx, organizationId, name);
        integrationExtraTools[`integration_${name}`] =
          createBoundIntegrationTool(name, summary);
      }
      debugLog('Built bound integration tools', {
        names: Object.keys(integrationExtraTools),
      });
    }

    // Create agent factory function from serializable config
    const createAgent = (options?: Record<string, unknown>) => {
      const config = createAgentConfig({
        name: agentConfig.name,
        instructions: agentConfig.instructions,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
        convexToolNames: agentConfig.convexToolNames as ToolName[] | undefined,
        extraTools: integrationExtraTools,
        useFastModel: agentConfig.useFastModel,
        model: agentConfig.model,
        maxSteps:
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
          (options?.maxSteps as number | undefined) ?? agentConfig.maxSteps,
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
          instructions: agentConfig.instructions,
        },
        {
          ctx,
          threadId,
          organizationId,
          userId,
          promptMessage,
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
      const err = isRecord(error) ? error : { message: String(error) };
      console.error('[runAgentGeneration] Full error details:', {
        name: getString(err, 'name'),
        message: getString(err, 'message'),
        code: getString(err, 'code'),
        status: err['status'],
        statusCode: err['statusCode'],
        cause: err['cause'],
        stack: getString(err, 'stack'),
        error: JSON.stringify(
          error,
          isRecord(error) ? Object.getOwnPropertyNames(error) : [],
          2,
        ),
      });

      // Classify and wrap error for retry decisions
      const classification = classifyError(error);
      throw new NonRetryableError(
        `${classification.description}: ${JSON.stringify({
          message: getString(err, 'message'),
          code: getString(err, 'code'),
          status: err['status'],
          cause: err['cause'],
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const handle = hooksConfig.beforeContext as FunctionHandle<'action'>;
    hooks.beforeContext = async (ctx, args) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        userId: args.userId,
        promptMessage: args.promptMessage,
        organizationId: args.organizationId,
        userTeamIds: args.userTeamIds,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      return result as BeforeContextResult;
    };
  }

  if (hooksConfig.beforeGenerate) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const handle = hooksConfig.beforeGenerate as FunctionHandle<'action'>;
    hooks.beforeGenerate = async (ctx, args, context, _hookData) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        promptMessage: args.promptMessage,
        attachments: args.attachments,
        contextMessagesTokens: context.stats.totalTokens,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      return result as BeforeGenerateResult;
    };
  }

  if (hooksConfig.afterGenerate) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const handle = hooksConfig.onError as FunctionHandle<'action'>;
    hooks.onError = async (ctx, args, error) => {
      const err = isRecord(error) ? error : { message: String(error) };
      await ctx.runAction(handle, {
        threadId: args.threadId,
        errorName: getString(err, 'name'),
        errorMessage: getString(err, 'message'),
        errorStatus: getNumber(err, 'status') ?? getString(err, 'status'),
        errorType: getString(err, 'type'),
        errorCode: getString(err, 'code'),
      });
    };
  }

  return hooks;
}
