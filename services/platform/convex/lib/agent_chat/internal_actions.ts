'use node';

import {
  Agent,
  listMessages,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';
import type { FunctionHandle } from 'convex/server';
import { v } from 'convex/values';

import {
  isRecord,
  getString,
  narrowStringUnion,
} from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import {
  createDelegationTool,
  buildDelegationInstructionsSection,
} from '../../agent_tools/delegation/create_delegation_tool';
import { loadDelegateAgents } from '../../agent_tools/delegation/load_delegation_agents';
import { createBoundIntegrationTool } from '../../agent_tools/integrations/create_bound_integration_tool';
import { fetchOperationsWithSchema } from '../../agent_tools/integrations/fetch_operations_summary';
import { createBoundMcpTool } from '../../agent_tools/mcp/create_bound_mcp_tool';
import { TOOL_NAMES, type ToolName } from '../../agent_tools/tool_names';
import { getToolRegistryMap } from '../../agent_tools/tool_registry';
import {
  createBoundWorkflowTool,
  sanitizeWorkflowName,
} from '../../agent_tools/workflows/create_bound_workflow_tool';
import { extractInputSchema } from '../../agent_tools/workflows/helpers/extract_input_schema';
import { recordFailure } from '../../providers/circuit_breaker';
import {
  isTransientProviderError,
  shouldFailoverToNextModel,
} from '../../providers/errors';
import { resolveLanguageModelWithFallback } from '../../providers/failover';
import { resolveLanguageModelById } from '../../providers/resolve_model';
import { generateAgentResponse } from '../agent_response';
import type {
  GenerateResponseHooks,
  BeforeContextResult,
  BeforeGenerateResult,
} from '../agent_response/types';
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
import {
  NonRetryableError,
  classifyProviderError,
} from '../error_classification';

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
  agentTeamIds: v.optional(v.array(v.string())),
  knowledgeFileIds: v.optional(v.array(v.string())),
  delegateSlugs: v.optional(v.array(v.string())),
  structuredResponsesEnabled: v.optional(v.boolean()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
  responseCacheEnabled: v.optional(v.boolean()),
  responseCacheTtlMs: v.optional(v.number()),
  noCacheToolNames: v.optional(v.array(v.string())),
  fallbackModels: v.optional(v.array(v.string())),
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
    generationParams: v.optional(v.any()),
    maxContextTokens: v.optional(v.number()),
    threadTeamId: v.optional(v.string()),
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
      generationParams,
      maxContextTokens,
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
      const toolBuildStart = Date.now();

      // Build all tool categories and fetch governance policy in parallel.
      // Each builder is independent, so running them concurrently saves
      // ~300-1200ms depending on the number of bindings.
      const [
        integrationExtraTools,
        delegationResult,
        workflowExtraTools,
        governanceResult,
        mcpExtraTools,
      ] = await Promise.all([
        buildIntegrationTools(ctx, agentConfig, organizationId),
        buildDelegationTools(ctx, agentConfig, organizationId),
        buildWorkflowTools(ctx, agentConfig),
        fetchGovernanceSystemPrompt(ctx, organizationId, parentThreadId),
        buildMcpTools(ctx, organizationId),
      ]);

      // Extract delegation tools and instructions append
      let delegationExtraTools: Record<string, unknown> | undefined;
      let delegationInstructionsAppend = '';
      if (delegationResult) {
        delegationExtraTools = delegationResult.tools;
        delegationInstructionsAppend = delegationResult.instructionsAppend;
        debugLog('Built delegation tools', {
          names: Object.keys(delegationExtraTools),
        });
      }

      if (workflowExtraTools) {
        debugLog('Built bound workflow tools', {
          names: Object.keys(workflowExtraTools),
        });
      }

      // Extract governance prompt prefixes/suffixes
      const { mandatoryPrefix, mandatorySuffix } = governanceResult;

      const toolBuildMs = Date.now() - toolBuildStart;
      debugLog('PERF_TOOL_BUILD', {
        durationMs: toolBuildMs,
        hasIntegrations: !!integrationExtraTools,
        hasDelegation: !!delegationExtraTools,
        hasWorkflows: !!workflowExtraTools,
        hasMcp: !!mcpExtraTools,
        hasGovernance: !!(mandatoryPrefix || mandatorySuffix),
      });

      // Merge all extra tools
      const allExtraTools: Record<string, unknown> | undefined =
        integrationExtraTools ||
        delegationExtraTools ||
        workflowExtraTools ||
        mcpExtraTools
          ? {
              ...integrationExtraTools,
              ...delegationExtraTools,
              ...workflowExtraTools,
              ...mcpExtraTools,
            }
          : undefined;

      // Combine instructions with delegation agent descriptions
      let finalInstructions = delegationInstructionsAppend
        ? agentConfig.instructions + delegationInstructionsAppend
        : agentConfig.instructions;

      // Wrap with mandatory governance system prompt (non-overridable)
      if (mandatoryPrefix) {
        finalInstructions = mandatoryPrefix + '\n\n' + finalInstructions;
      }
      if (mandatorySuffix) {
        finalInstructions = finalInstructions + '\n\n' + mandatorySuffix;
      }

      // Build hooks object from FunctionHandle strings
      const hooks: GenerateResponseHooks | undefined = hooksConfig
        ? buildHooksFromConfig(hooksConfig)
        : undefined;

      // Build tools summary for context window display
      const toolsSummary = buildToolsSummary(
        agentConfig.convexToolNames,
        allExtraTools,
      );

      // Build ordered list of models to try: primary + fallbacks
      const primaryModelId = model === 'default' ? undefined : model;
      const modelsToTry: Array<string | undefined> = [primaryModelId];
      if (agentConfig.fallbackModels?.length) {
        for (const fb of agentConfig.fallbackModels) {
          modelsToTry.push(fb);
        }
      }

      // Fallback retry loop — try each model in order until one succeeds
      let lastFallbackError: unknown;
      for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
        const currentModelId = modelsToTry[attempt];

        try {
          // Resolve model from provider files with automatic failover
          const { languageModel, modelData } = currentModelId
            ? await resolveLanguageModelById(ctx, {
                modelId: currentModelId,
                providerName: agentConfig.provider,
              })
            : await resolveLanguageModelWithFallback(ctx, {
                providerName: agentConfig.provider,
                tag: 'chat',
              });
          const resolvedProvider = modelData.providerName;
          const resolvedModelId = modelData.modelId;

          // Create agent factory function from serializable config
          const createAgent = () => {
            // Filter tools: exclude rag_search/web when their retrieval mode
            // is 'context' or 'off' (tool should only be available in 'tool'/'both').
            const knowledgeMode = agentConfig.knowledgeMode ?? 'off';
            const webSearchMode = agentConfig.webSearchMode ?? 'off';
            const filteredToolNames = agentConfig.convexToolNames?.filter(
              (n): n is ToolName => {
                if (!(TOOL_NAMES as readonly string[]).includes(n))
                  return false;
                if (
                  n === 'rag_search' &&
                  knowledgeMode !== 'tool' &&
                  knowledgeMode !== 'both'
                )
                  return false;
                if (
                  n === 'web' &&
                  webSearchMode !== 'tool' &&
                  webSearchMode !== 'both'
                )
                  return false;
                return true;
              },
            );
            const config = createAgentConfig({
              name: agentConfig.name,
              instructions: finalInstructions,
              languageModel,
              convexToolNames:
                filteredToolNames && filteredToolNames.length > 0
                  ? filteredToolNames
                  : undefined,
              extraTools: allExtraTools,
              maxSteps: agentConfig.maxSteps,
              outputFormat: agentConfig.outputFormat,
            });
            return new Agent(components.agent, config);
          };

          const result = await generateAgentResponse(
            {
              agentType,
              createAgent,
              model: resolvedModelId,
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
              agentTeamIds: agentConfig.agentTeamIds,
              knowledgeFileIds: agentConfig.knowledgeFileIds,
              structuredResponsesEnabled:
                agentConfig.structuredResponsesEnabled,
              responseCacheEnabled: agentConfig.responseCacheEnabled,
              responseCacheTtlMs: agentConfig.responseCacheTtlMs,
              noCacheToolNames: agentConfig.noCacheToolNames,
              maxContextTokens,
              instructions: finalInstructions,
              toolsSummary,
            },
            {
              ctx,
              threadId,
              organizationId,
              userId,
              agentSlug: args.agentSlug,
              teamIds: args.threadTeamId ? [args.threadTeamId] : undefined,
              providerCost:
                modelData.inputCentsPerMillion != null
                  ? {
                      inputCentsPerMillion: modelData.inputCentsPerMillion,
                      outputCentsPerMillion:
                        modelData.outputCentsPerMillion ?? 0,
                    }
                  : undefined,
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
              generationParams,
              // Suppress error cleanup (stream error, generation status clear,
              // failed message) when there are more fallback models to try.
              // The fallback loop handles cleanup itself.
              suppressErrorCleanup: attempt < modelsToTry.length - 1,
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
                  content:
                    'I was unable to generate a response. Please try again.',
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
        } catch (fallbackError) {
          lastFallbackError = fallbackError;
          const hasMoreFallbacks = attempt < modelsToTry.length - 1;

          // Retry on any provider-specific error with remaining fallbacks.
          // This includes transient errors (429, 5xx) AND non-transient
          // provider errors (401 auth, 404 model-not-found) because a
          // different fallback model may use a different provider.
          if (hasMoreFallbacks && shouldFailoverToNextModel(fallbackError)) {
            const failedModelLabel = currentModelId ?? model;
            const nextModel = modelsToTry[attempt + 1] ?? 'default';

            // Record circuit breaker failure only for transient errors
            // (429, 5xx, timeouts). Non-transient errors like 401/404 are
            // config issues, not provider flakiness.
            if (
              currentModelId &&
              agentConfig.provider &&
              isTransientProviderError(fallbackError)
            ) {
              recordFailure(agentConfig.provider, currentModelId);
            }

            // Check remaining deadline budget before retrying
            if (deadlineMs && Date.now() >= deadlineMs - 5000) {
              debugLog('FALLBACK_SKIP_DEADLINE', {
                failedModel: failedModelLabel,
                remainingMs: deadlineMs - Date.now(),
              });
              throw fallbackError;
            }

            const errStatus = isRecord(fallbackError)
              ? (fallbackError['status'] ?? fallbackError['statusCode'])
              : undefined;
            const errMessage = isRecord(fallbackError)
              ? getString(fallbackError, 'message')
              : undefined;
            debugLog('MODEL_FALLBACK', {
              attempt: attempt + 1,
              failedModel: failedModelLabel,
              nextModel,
              errorStatus:
                typeof errStatus === 'number' ? errStatus : undefined,
              errorMessage: errMessage?.slice(0, 200),
            });

            // Save system message so the user sees the fallback in chat
            try {
              await saveMessage(ctx, components.agent, {
                threadId,
                message: {
                  role: 'system',
                  content: `[MODEL_FALLBACK] ${failedModelLabel} was unavailable. Trying ${nextModel}...`,
                },
              });
            } catch (msgError) {
              console.error(
                '[runAgentGeneration] Failed to save fallback message:',
                msgError,
              );
            }

            // Clean up stale assistant messages from this attempt.
            // With suppressErrorCleanup, generateAgentResponse skips saving
            // failed messages, but the Agent SDK may have created a pending
            // message before the error. Convert any failed/pending assistant
            // messages to a system fallback note.
            try {
              const msgs = await listMessages(ctx, components.agent, {
                threadId,
                paginationOpts: { cursor: null, numItems: 5 },
                excludeToolMessages: true,
              });
              const staleAssistants = msgs.page.filter(
                (m: MessageDoc) =>
                  m.message?.role === 'assistant' &&
                  (m.status === 'failed' || m.status === 'pending'),
              );
              for (const stale of staleAssistants) {
                await ctx.runMutation(components.agent.messages.updateMessage, {
                  messageId: stale._id,
                  patch: {
                    status: 'success',
                    message: {
                      role: 'system',
                      content: `[MODEL_FALLBACK] ${failedModelLabel} failed — retrying with ${nextModel}.`,
                    },
                  },
                });
              }
            } catch (cleanupError) {
              debugLog('FALLBACK_CLEANUP_ERROR', { error: cleanupError });
            }

            continue;
          }

          // Non-transient error or no more fallbacks — rethrow
          throw fallbackError;
        }
      }

      // Should not reach here, but satisfy TypeScript
      throw lastFallbackError ?? new Error('No model could be resolved');
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
          const providerError = classifyProviderError(error);
          await saveMessage(ctx, components.agent, {
            threadId,
            message: {
              role: 'assistant',
              content: providerError.userMessage,
            },
            metadata: {
              status: 'failed',
              error: `[${providerError.errorType}] ${getString(err, 'message') ?? 'Unknown error'}`,
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

// ---------------------------------------------------------------------------
// T2 helper functions: parallelized tool building
// ---------------------------------------------------------------------------

interface AgentConfigForTools {
  integrationBindings?: string[];
  delegateSlugs?: string[];
  workflowBindings?: string[];
}

/**
 * Build bound integration tools for all configured integration bindings.
 */
async function buildIntegrationTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
  organizationId: string,
): Promise<Record<string, unknown> | undefined> {
  if (!agentConfig.integrationBindings?.length) return undefined;

  const results = await Promise.all(
    agentConfig.integrationBindings.map(async (name) => {
      const fetched = await fetchOperationsWithSchema(
        ctx,
        organizationId,
        name,
      );
      return {
        key: `integration_${name}`,
        tool: createBoundIntegrationTool(
          name,
          fetched?.summary,
          fetched?.operations,
          fetched?.metadata,
        ),
      };
    }),
  );

  const tools: Record<string, unknown> = {};
  for (const { key, tool } of results) {
    tools[key] = tool;
  }
  return tools;
}

/**
 * Build delegation tools for all configured delegate slugs.
 */
async function buildDelegationTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
  organizationId: string,
): Promise<
  | {
      tools: Record<string, unknown>;
      instructionsAppend: string;
    }
  | undefined
> {
  if (!agentConfig.delegateSlugs?.length) return undefined;

  const delegates = await loadDelegateAgents(
    ctx,
    agentConfig.delegateSlugs,
    organizationId,
    'default',
  );

  if (delegates.length === 0) return undefined;

  const tools: Record<string, unknown> = {};
  for (const delegate of delegates) {
    const delegationTool = createDelegationTool(delegate);
    tools[delegationTool.name] = delegationTool.tool;
  }

  return {
    tools,
    instructionsAppend: buildDelegationInstructionsSection(delegates),
  };
}

/**
 * Build bound workflow tools for all configured workflow bindings.
 */
async function buildWorkflowTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
): Promise<Record<string, unknown> | undefined> {
  if (!agentConfig.workflowBindings?.length) return undefined;

  const results = await Promise.all(
    agentConfig.workflowBindings.map(async (slug) => {
      const result: unknown = await ctx.runAction(
        internal.workflows.file_actions.readWorkflowForExecution,
        { orgSlug: 'default', workflowSlug: slug },
      );

      if (!isRecord(result) || result.ok !== true) {
        return null;
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig shape
      const config = result.config as {
        name: string;
        description?: string;
        enabled?: boolean;
        steps: Array<{ stepType: string; config?: unknown }>;
      };

      if (!config.enabled) {
        return null;
      }

      const startStep = config.steps.find((s) => s.stepType === 'start');
      const inputSchema = extractInputSchema(startStep?.config);

      const toolKey = `workflow_${sanitizeWorkflowName(config.name)}_${slug}`;
      return {
        key: toolKey,
        tool: createBoundWorkflowTool(
          {
            workflowSlug: slug,
            name: config.name,
            description: config.description,
          },
          inputSchema,
        ),
      };
    }),
  );

  const tools: Record<string, unknown> = {};
  for (const entry of results) {
    if (entry) {
      tools[entry.key] = entry.tool;
    }
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}

/**
 * Fetch the mandatory system prompt governance policy.
 * Skipped for sub-agents to prevent double-injection in delegation chains.
 */
async function fetchGovernanceSystemPrompt(
  ctx: ActionCtx,
  organizationId: string,
  parentThreadId: string | undefined,
): Promise<{ mandatoryPrefix: string; mandatorySuffix: string }> {
  if (parentThreadId) {
    return { mandatoryPrefix: '', mandatorySuffix: '' };
  }

  const systemPromptPolicy = await ctx.runQuery(
    internal.governance.internal_queries.getSystemPromptPolicyInternal,
    { organizationId },
  );

  let mandatoryPrefix = '';
  let mandatorySuffix = '';

  if (
    systemPromptPolicy?.enabled !== false &&
    isRecord(systemPromptPolicy?.config)
  ) {
    const cfg = systemPromptPolicy.config;
    if (
      typeof cfg.mandatoryPrefixPrompt === 'string' &&
      cfg.mandatoryPrefixPrompt.trim()
    ) {
      mandatoryPrefix = cfg.mandatoryPrefixPrompt.trim();
    }
    if (
      typeof cfg.mandatorySuffixPrompt === 'string' &&
      cfg.mandatorySuffixPrompt.trim()
    ) {
      mandatorySuffix = cfg.mandatorySuffixPrompt.trim();
    }
  }

  return { mandatoryPrefix, mandatorySuffix };
}

/**
 * Build bound MCP server tools from all active MCP servers for the org.
 */
async function buildMcpTools(
  ctx: ActionCtx,
  organizationId: string,
): Promise<Record<string, unknown> | undefined> {
  interface ActiveMcpServer {
    _id: string;
    name: string;
    displayName: string;
    discoveredTools?: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      requiresApproval?: boolean;
    }>;
  }

  const activeServers: ActiveMcpServer[] = await ctx.runQuery(
    internal.mcp_servers.internal_queries.listActiveByOrg,
    { organizationId },
  );

  if (activeServers.length === 0) return undefined;

  const tools: Record<string, unknown> = {};
  for (const server of activeServers) {
    if (!server.discoveredTools?.length) continue;
    for (const tool of server.discoveredTools) {
      const toolKey = `mcp_${server.name}_${tool.name}`;
      tools[toolKey] = createBoundMcpTool(server._id, server.displayName, tool);
    }
  }

  if (Object.keys(tools).length > 0) {
    debugLog('Built bound MCP tools', { names: Object.keys(tools) });
    return tools;
  }
  return undefined;
}

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
