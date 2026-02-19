'use node';

import type { FunctionHandle } from 'convex/server';

import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';

import type {
  GenerateResponseHooks,
  BeforeContextResult,
  BeforeGenerateResult,
} from '../agent_response/types';

import {
  isRecord,
  getString,
  narrowStringUnion,
} from '../../../lib/utils/type-guards';
import { components } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { createBoundIntegrationTool } from '../../agent_tools/integrations/create_bound_integration_tool';
import { fetchOperationsSummary } from '../../agent_tools/integrations/fetch_operations_summary';
import { TOOL_NAMES, type ToolName } from '../../agent_tools/tool_names';
import { getToolRegistryMap } from '../../agent_tools/tool_registry';
import { generateAgentResponse } from '../agent_response';
import { processAttachments } from '../attachments';
import {
  estimateTokens,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  CONTEXT_SAFETY_MARGIN,
  SYSTEM_INSTRUCTIONS_TOKENS,
  OUTPUT_RESERVE,
} from '../context_management';
import {
  AGENT_CONTEXT_CONFIGS,
  type AgentType,
} from '../context_management/constants';
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
  contextFeatures: v.optional(v.array(v.string())),
});

const hooksConfigValidator = v.object({
  beforeContext: v.optional(v.string()),
  beforeGenerate: v.optional(v.string()),
  afterGenerate: v.optional(v.string()),
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
    deadlineMs: v.optional(v.number()),
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
      deadlineMs,
    } = args;

    const agentType = narrowStringUnion(
      agentTypeStr,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys loses literal types; keys are known AgentType values
      Object.keys(AGENT_CONTEXT_CONFIGS) as AgentType[],
    );
    if (!agentType) {
      throw new Error(`Invalid agent type: ${agentTypeStr}`);
    }

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
        convexToolNames: agentConfig.convexToolNames
          ? agentConfig.convexToolNames.filter((n): n is ToolName =>
              (TOOL_NAMES as readonly string[]).includes(n),
            )
          : undefined,
        extraTools: integrationExtraTools,
        useFastModel: agentConfig.useFastModel,
        model: agentConfig.model,
        maxSteps:
          (typeof options?.maxSteps === 'number'
            ? options.maxSteps
            : undefined) ?? agentConfig.maxSteps,
        outputFormat: agentConfig.outputFormat,
        enableVectorSearch: agentConfig.enableVectorSearch,
      });
      return new Agent(components.agent, config);
    };

    // Build hooks object from FunctionHandle strings
    const hooks: GenerateResponseHooks | undefined = hooksConfig
      ? buildHooksFromConfig(hooksConfig, agentConfig.contextFeatures)
      : undefined;

    // Build tools summary for context window display
    const toolsSummary = buildToolsSummary(
      agentConfig.convexToolNames,
      integrationExtraTools,
    );

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
          toolsSummary,
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
          deadlineMs,
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
function buildHooksFromConfig(
  hooksConfig: {
    beforeContext?: string;
    beforeGenerate?: string;
    afterGenerate?: string;
  },
  contextFeatures?: string[],
): GenerateResponseHooks {
  const hooks: GenerateResponseHooks = {};

  if (hooksConfig.beforeContext) {
    const handle =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores FunctionHandle as string; branded type requires assertion
      hooksConfig.beforeContext as unknown as FunctionHandle<'action'>;
    hooks.beforeContext = async (ctx, args) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        userId: args.userId,
        promptMessage: args.promptMessage,
        organizationId: args.organizationId,
        userTeamIds: args.userTeamIds,
        contextFeatures,
      });
      // runAction returns unknown; we trust the hook contract
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- hook return type guaranteed by contract
      return result as BeforeContextResult;
    };
  }

  if (hooksConfig.beforeGenerate) {
    const handle =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores FunctionHandle as string; branded type requires assertion
      hooksConfig.beforeGenerate as unknown as FunctionHandle<'action'>;
    hooks.beforeGenerate = async (ctx, args, context, _hookData) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        promptMessage: args.promptMessage,
        attachments: args.attachments,
        contextMessagesTokens: context.stats.totalTokens,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- hook return type guaranteed by contract
      return result as BeforeGenerateResult;
    };
  }

  if (hooksConfig.afterGenerate) {
    const handle =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores FunctionHandle as string; branded type requires assertion
      hooksConfig.afterGenerate as unknown as FunctionHandle<'action'>;
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

  return hooks;
}

/**
 * Extract a tool description from a createTool() result.
 */
function getToolDescription(tool: unknown): string | undefined {
  if (isRecord(tool) && typeof tool['description'] === 'string') {
    return tool['description'];
  }
  return undefined;
}

/**
 * Build a formatted summary of all tools available to the agent.
 * Used for context window display only — not sent to the LLM.
 */
function buildToolsSummary(
  convexToolNames: string[] | undefined,
  integrationExtraTools: Record<string, unknown> | undefined,
): string | undefined {
  const entries: string[] = [];

  // Registry tools
  if (convexToolNames?.length) {
    const registry = getToolRegistryMap();
    for (const name of convexToolNames) {
      const validName = narrowStringUnion(name, TOOL_NAMES);
      const toolDef = validName ? registry[validName] : undefined;
      if (toolDef) {
        const description = getToolDescription(toolDef.tool);
        entries.push(
          description ? `### ${name}\n${description}` : `### ${name}`,
        );
      } else {
        entries.push(`### ${name}`);
      }
    }
  }

  // Integration-bound tools
  if (integrationExtraTools) {
    for (const [name, tool] of Object.entries(integrationExtraTools)) {
      const description = getToolDescription(tool);
      entries.push(description ? `### ${name}\n${description}` : `### ${name}`);
    }
  }

  if (entries.length === 0) {
    return undefined;
  }

  return entries.join('\n\n');
}

const beforeGenerateDebugLog = createDebugLog(
  'DEBUG_CHAT_AGENT',
  '[beforeGenerateHook]',
);

export const beforeGenerateHook = internalAction({
  args: {
    threadId: v.string(),
    promptMessage: v.string(),
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
    contextMessagesTokens: v.number(),
  },
  returns: v.object({
    promptContent: v.optional(v.any()),
    contextExceedsBudget: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { threadId, promptMessage, attachments, contextMessagesTokens } =
      args;

    // Token budget check for logging
    const currentPromptTokens = estimateTokens(promptMessage || '');
    const contextBudget =
      DEFAULT_MODEL_CONTEXT_LIMIT * CONTEXT_SAFETY_MARGIN -
      SYSTEM_INSTRUCTIONS_TOKENS -
      currentPromptTokens -
      OUTPUT_RESERVE;

    const contextExceedsBudget = contextMessagesTokens > contextBudget;
    if (contextExceedsBudget) {
      beforeGenerateDebugLog('Context may exceed budget', {
        threadId,
        budget: contextBudget,
        contextTokens: contextMessagesTokens,
      });
    }

    // Process attachments
    const { promptContent: attachmentPrompt } = await processAttachments(
      ctx,
      attachments ?? [],
      promptMessage,
      { debugLog: beforeGenerateDebugLog, toolName: 'agent' },
    );

    return {
      promptContent: attachmentPrompt,
      contextExceedsBudget,
    };
  },
});
