'use node';

import type { FunctionHandle } from 'convex/server';

import {
  Agent,
  listMessages,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';
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
import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import {
  createDelegationTool,
  buildDelegationInstructionsSection,
} from '../../agent_tools/delegation/create_delegation_tool';
import { loadDelegateAgents } from '../../agent_tools/delegation/load_delegation_agents';
import { createBoundIntegrationTool } from '../../agent_tools/integrations/create_bound_integration_tool';
import { fetchOperationsSummary } from '../../agent_tools/integrations/fetch_operations_summary';
import { TOOL_NAMES, type ToolName } from '../../agent_tools/tool_names';
import { getToolRegistryMap } from '../../agent_tools/tool_registry';
import {
  createBoundWorkflowTool,
  sanitizeWorkflowName,
} from '../../agent_tools/workflows/create_bound_workflow_tool';
import { extractInputSchema } from '../../agent_tools/workflows/helpers/extract_input_schema';
import {
  resolveLanguageModel,
  resolveLanguageModelById,
} from '../../providers/resolve_model';
import { generateAgentResponse } from '../agent_response';
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
import { NonRetryableError } from '../error_classification';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[runAgentGeneration]');

const serializableAgentConfigValidator = v.object({
  name: v.string(),
  instructions: v.string(),
  convexToolNames: v.optional(v.array(v.string())),
  integrationBindings: v.optional(v.array(v.string())),
  workflowBindings: v.optional(v.array(v.string())),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  maxSteps: v.optional(v.number()),
  outputFormat: v.optional(v.union(v.literal('text'), v.literal('json'))),
  knowledgeMode: v.optional(
    v.union(
      v.literal('off'),
      v.literal('tool'),
      v.literal('context'),
      v.literal('both'),
    ),
  ),
  webSearchMode: v.optional(
    v.union(
      v.literal('off'),
      v.literal('tool'),
      v.literal('context'),
      v.literal('both'),
    ),
  ),
  includeTeamKnowledge: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  agentTeamId: v.optional(v.string()),
  knowledgeFileIds: v.optional(v.array(v.string())),
  delegateAgentIds: v.optional(v.array(v.string())),
  structuredResponsesEnabled: v.optional(v.boolean()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
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
    provider: v.optional(v.string()),
    debugTag: v.string(),
    enableStreaming: v.optional(v.boolean()),
    hooks: v.optional(hooksConfigValidator),
    threadId: v.string(),
    organizationId: v.string(),
    userId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    promptMessage: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
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
      provider: _provider,
      debugTag,
      enableStreaming,
      hooks: hooksConfig,
      threadId,
      organizationId,
      userId,
      promptMessage,
      additionalContext,
      userContext,
      parentThreadId,
      agentOptions,
      attachments,
      streamId,
      promptMessageId,
      maxSteps,
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

    try {
      // Build bound integration tools eagerly (before synchronous createAgent closure)
      let integrationExtraTools: Record<string, unknown> | undefined;
      if (agentConfig.integrationBindings?.length) {
        integrationExtraTools = {};
        for (const name of agentConfig.integrationBindings) {
          const summary = await fetchOperationsSummary(
            ctx,
            organizationId,
            name,
          );
          integrationExtraTools[`integration_${name}`] =
            createBoundIntegrationTool(name, summary);
        }
        debugLog('Built bound integration tools', {
          names: Object.keys(integrationExtraTools),
        });
      }

      // Build delegation tools dynamically
      let delegationExtraTools: Record<string, unknown> | undefined;
      let delegationInstructionsAppend = '';
      if (agentConfig.delegateAgentIds?.length) {
        const delegates = await loadDelegateAgents(
          ctx,
          agentConfig.delegateAgentIds,
          organizationId,
          'default',
        );

        if (delegates.length > 0) {
          delegationExtraTools = {};
          for (const delegate of delegates) {
            const delegationTool = createDelegationTool(delegate);
            delegationExtraTools[delegationTool.name] = delegationTool.tool;
          }
          delegationInstructionsAppend =
            buildDelegationInstructionsSection(delegates);
          debugLog('Built delegation tools', {
            names: Object.keys(delegationExtraTools),
          });
        }
      }

      // Build bound workflow tools eagerly (file-based)
      let workflowExtraTools: Record<string, unknown> | undefined;
      if (agentConfig.workflowBindings?.length) {
        workflowExtraTools = {};
        for (const slug of agentConfig.workflowBindings) {
          const result: unknown = await ctx.runAction(
            internal.workflows.file_actions.readWorkflowForExecution,
            { orgSlug: 'default', workflowSlug: slug },
          );

          if (!isRecord(result) || result.ok !== true) {
            debugLog('Skipping bound workflow (not found)', { slug });
            continue;
          }

          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig shape
          const config = result.config as {
            name: string;
            description?: string;
            enabled?: boolean;
            steps: Array<{ stepType: string; config?: unknown }>;
          };

          if (!config.enabled) {
            debugLog('Skipping bound workflow (disabled)', { slug });
            continue;
          }

          const startStep = config.steps.find((s) => s.stepType === 'start');
          const inputSchema = extractInputSchema(startStep?.config);

          const toolKey = `workflow_${sanitizeWorkflowName(config.name)}_${slug}`;
          workflowExtraTools[toolKey] = createBoundWorkflowTool(
            {
              workflowSlug: slug,
              name: config.name,
              description: config.description,
            },
            inputSchema,
          );
        }

        if (Object.keys(workflowExtraTools).length > 0) {
          debugLog('Built bound workflow tools', {
            names: Object.keys(workflowExtraTools),
          });
        }
      }

      // Merge all extra tools
      const allExtraTools: Record<string, unknown> | undefined =
        integrationExtraTools || delegationExtraTools || workflowExtraTools
          ? {
              ...integrationExtraTools,
              ...delegationExtraTools,
              ...workflowExtraTools,
            }
          : undefined;

      // Combine instructions with delegation agent descriptions
      const finalInstructions = delegationInstructionsAppend
        ? agentConfig.instructions + delegationInstructionsAppend
        : agentConfig.instructions;

      // Resolve model from provider files
      const modelId = model === 'default' ? undefined : model;
      const { languageModel, modelData } = modelId
        ? await resolveLanguageModelById(ctx, {
            modelId,
            providerName: agentConfig.provider,
          })
        : await resolveLanguageModel(ctx, {
            tag: 'chat',
            providerName: agentConfig.provider,
          });
      const resolvedProvider = modelData.providerName;

      // Create agent factory function from serializable config
      const createAgent = () => {
        const config = createAgentConfig({
          name: agentConfig.name,
          instructions: finalInstructions,
          languageModel,
          convexToolNames: agentConfig.convexToolNames
            ? agentConfig.convexToolNames.filter((n): n is ToolName =>
                (TOOL_NAMES as readonly string[]).includes(n),
              )
            : undefined,
          extraTools: allExtraTools,
          maxSteps: agentConfig.maxSteps,
          outputFormat: agentConfig.outputFormat,
        });
        return new Agent(components.agent, config);
      };

      // Build hooks object from FunctionHandle strings
      const hooks: GenerateResponseHooks | undefined = hooksConfig
        ? buildHooksFromConfig(hooksConfig)
        : undefined;

      // Build tools summary for context window display
      const toolsSummary = buildToolsSummary(
        agentConfig.convexToolNames,
        allExtraTools,
      );

      const result = await generateAgentResponse(
        {
          agentType,
          createAgent,
          model,
          provider: resolvedProvider,
          debugTag,
          enableStreaming,
          hooks,
          convexToolNames: agentConfig.convexToolNames,
          knowledgeMode: agentConfig.knowledgeMode,
          webSearchMode: agentConfig.webSearchMode,
          includeTeamKnowledge: agentConfig.includeTeamKnowledge,
          includeOrgKnowledge: agentConfig.includeOrgKnowledge,
          agentTeamId: agentConfig.agentTeamId,
          knowledgeFileIds: agentConfig.knowledgeFileIds,
          structuredResponsesEnabled: agentConfig.structuredResponsesEnabled,
          instructions: finalInstructions,
          toolsSummary,
        },
        {
          ctx,
          threadId,
          organizationId,
          userId,
          promptMessage,
          additionalContext,
          userContext,
          parentThreadId,
          agentOptions,
          attachments,
          streamId,
          promptMessageId,
          maxSteps,
          deadlineMs,
        },
      );

      // User cancelled — cancelGeneration already handled message state
      if (result.finishReason === 'cancelled') {
        return result;
      }

      // Validate response — save a failed message so the client exits loading
      if (!result.text?.trim()) {
        try {
          await saveMessage(ctx, components.agent, {
            threadId,
            message: {
              role: 'assistant',
              content: 'I was unable to generate a response. Please try again.',
            },
            metadata: {
              status: 'failed',
              error: 'Agent returned empty response',
            },
          });
        } catch (saveError) {
          console.error(
            '[runAgentGeneration] Failed to save failed message:',
            saveError,
          );
        }
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

      // Stream cleanup (persistent text stream + agent SDK streams) is handled
      // by generateAgentResponse's catch block. This outer catch only ensures
      // a failed assistant message exists for the frontend.

      // Clear generation status so the UI stops showing "Thinking..."
      if (streamId) {
        try {
          await ctx.runMutation(
            internal.threads.internal_mutations.clearGenerationStatus,
            { threadId, streamId },
          );
        } catch (clearError) {
          console.error(
            '[runAgentGeneration] Failed to clear generation status:',
            clearError,
          );
        }
      }

      try {
        const msgs = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { cursor: null, numItems: 5 },
          excludeToolMessages: true,
        });
        const newestAssistant = msgs.page.find(
          (m: MessageDoc) => m.message?.role === 'assistant',
        );
        const hasFailedAssistant = newestAssistant?.status === 'failed';
        if (!hasFailedAssistant) {
          await saveMessage(ctx, components.agent, {
            threadId,
            message: {
              role: 'assistant',
              content:
                'I was unable to complete your request. Please try again.',
            },
            metadata: {
              status: 'failed',
              error: getString(err, 'message') ?? 'Unknown error',
            },
          });
        }
      } catch (saveError) {
        console.error(
          '[runAgentGeneration] Failed to save failed message:',
          saveError,
        );
      }

      throw new NonRetryableError(
        `Agent generation failed: ${JSON.stringify({
          message: getString(err, 'message'),
          code: getString(err, 'code'),
          status: err['status'],
          cause: err['cause'],
        })}`,
        error,
        'generation_error',
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
}): GenerateResponseHooks {
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
  handler: async (_ctx, args) => {
    const { threadId, promptMessage, contextMessagesTokens } = args;

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

    return { promptContent: undefined, contextExceedsBudget };
  },
});
