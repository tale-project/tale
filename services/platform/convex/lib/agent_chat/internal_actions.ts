'use node';

import {
  Agent,
  listMessages,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';
import type { ModelMessage } from 'ai';
import type { FunctionHandle } from 'convex/server';
import { v } from 'convex/values';
import { snakeCase } from 'lodash';

import { parseModelRef } from '../../../lib/shared/utils/model-ref';
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
import { createBoundWorkflowTool } from '../../agent_tools/workflows/create_bound_workflow_tool';
import { extractInputSchema } from '../../agent_tools/workflows/helpers/extract_input_schema';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
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
import { buildInlineMultiModalPrompt } from '../attachments/build_inline_multi_modal_prompt';
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
  fallbackModels: v.optional(v.array(v.string())),
  personalizationMode: v.optional(v.union(v.literal('on'), v.literal('off'))),
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
    /**
     * Un-augmented user text (without the attachment markdown that
     * `buildMessageWithAttachments` appends to `promptMessage`). Used as the
     * text part when building a multimodal prompt for vision-capable models,
     * so PDF/audio references aren't duplicated.
     */
    originalUserText: v.optional(v.string()),
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
      originalUserText,
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
      //
      // `orgSlug` and `orgLocale` are resolved in the same outer Promise.all
      // and threaded into the delegation+workflow builders below. Both
      // builders need orgSlug, and delegation needs orgLocale — resolving
      // them once here avoids duplicate queries when both run.
      const [
        integrationExtraTools,
        orgSlug,
        orgLocale,
        governanceResult,
        mcpExtraTools,
      ] = await Promise.all([
        buildIntegrationTools(ctx, agentConfig, organizationId),
        resolveOrgSlug(ctx, organizationId),
        ctx.runQuery(
          internal.organizations.internal_queries.getOrganizationDefaultLocale,
          { organizationId },
        ),
        fetchGovernanceSystemPrompt(ctx, organizationId, parentThreadId),
        buildMcpTools(ctx, organizationId),
      ]);

      // Delegation and workflows depend on orgSlug (+ orgLocale for
      // delegation), so they run after the slug is resolved but in parallel
      // with each other.
      const [delegationResult, workflowExtraTools] = await Promise.all([
        buildDelegationTools(
          ctx,
          agentConfig,
          organizationId,
          orgSlug,
          orgLocale,
        ),
        buildWorkflowTools(ctx, agentConfig, orgSlug),
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
          // orgSlug was resolved once in the outer Promise.all and is shared
          // across model lookup + delegation + workflows so multi-org
          // deployments read each org's own provider/API-key files.
          // Parse provider qualifier from the ref (e.g. "openrouter:foo" → {providerName:"openrouter", modelId:"foo"}).
          // Per-entry qualifier takes precedence over the agent's top-level provider.
          const parsed = currentModelId
            ? parseModelRef(currentModelId)
            : undefined;
          const { languageModel, modelData } = parsed
            ? await resolveLanguageModelById(ctx, {
                modelId: parsed.modelId,
                providerName: parsed.providerName ?? agentConfig.provider,
                orgSlug,
              })
            : await resolveLanguageModelWithFallback(ctx, {
                providerName: agentConfig.provider,
                tag: 'chat',
                orgSlug,
              });
          const resolvedProvider = modelData.providerName;
          const resolvedModelId = modelData.modelId;

          // Vision branch: when the resolved chat model has the `vision`
          // tag and the turn carries image attachments, inline the images
          // as multimodal content and drop the `image` tool for this
          // attempt. Failover to a non-vision model on the next attempt
          // re-evaluates and reverts to the markdown + image-tool path.
          const imageAttachments =
            attachments?.filter((a) => a.fileType.startsWith('image/')) ?? [];
          const isVisionCapable = modelData.tags.includes('vision');
          const useMultiModal = isVisionCapable && imageAttachments.length > 0;

          let multiModalPrompt: ModelMessage[] | undefined;
          if (useMultiModal) {
            const built = await buildInlineMultiModalPrompt(ctx, {
              userText: originalUserText ?? promptMessage,
              imageAttachments,
            });
            multiModalPrompt = built.prompt;
            debugLog('MULTIMODAL_BRANCH', {
              modelId: resolvedModelId,
              inlinedImageCount: built.inlinedImageCount,
              skippedImages: built.skippedImages,
            });
          }

          // Read+write symmetry: only attach `propose_memory` when ALL
          // runtime kill-switches agree. Same gate as buildUserPersonalization
          // (org feature flag, prefs.enabled === true, threadDisablePersonalization).
          // The agent-level `personalizationMode === 'off'` short-circuits
          // before we hit the DB.
          const personalizationActive =
            userId &&
            organizationId &&
            agentConfig.personalizationMode !== 'off'
              ? await ctx.runQuery(
                  internal.personalization.internal_queries
                    .isPersonalizationActiveForChat,
                  { userId, organizationId, threadId },
                )
              : false;

          // Create agent factory function from serializable config
          const createAgent = () => {
            // Filter tools: exclude rag_search/web when their retrieval mode
            // is 'context' or 'off' (tool should only be available in 'tool'/'both').
            // Drop `image` when the chat model handles images natively.
            const knowledgeMode = agentConfig.knowledgeMode ?? 'off';
            const webSearchMode = agentConfig.webSearchMode ?? 'off';
            const baseToolList = agentConfig.convexToolNames ?? [];
            const withPropose: string[] =
              personalizationActive && !baseToolList.includes('propose_memory')
                ? [...baseToolList, 'propose_memory']
                : baseToolList;
            const filteredToolNames = withPropose.filter((n): n is ToolName => {
              if (!(TOOL_NAMES as readonly string[]).includes(n)) return false;
              if (n === 'propose_memory' && !personalizationActive)
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
              if (n === 'image' && useMultiModal) return false;
              return true;
            });
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
              maxContextTokens,
              instructions: finalInstructions,
              toolsSummary,
              personalizationMode: agentConfig.personalizationMode,
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
              multiModalPrompt,
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
 *
 * `orgSlug` and `orgLocale` are resolved once by the caller (hoisted into
 * the outer Promise.all) so they can be shared with sibling builders —
 * notably workflows, which also need the real orgSlug for multi-tenant
 * filesystem lookups. Delegate systemInstructions and the appended scaffold
 * text both resolve against `orgLocale` so parent + delegates speak the
 * same language.
 */
async function buildDelegationTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
  organizationId: string,
  orgSlug: string,
  orgLocale: string,
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
    orgSlug,
    orgLocale,
  );

  if (delegates.length === 0) return undefined;

  const tools: Record<string, unknown> = {};
  for (const delegate of delegates) {
    const delegationTool = createDelegationTool(delegate);
    tools[delegationTool.name] = delegationTool.tool;
  }

  return {
    tools,
    instructionsAppend: buildDelegationInstructionsSection(
      delegates,
      orgLocale,
    ),
  };
}

/**
 * Build bound workflow tools for all configured workflow bindings.
 */
async function buildWorkflowTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
  orgSlug: string,
): Promise<Record<string, unknown> | undefined> {
  if (!agentConfig.workflowBindings?.length) return undefined;

  const results = await Promise.all(
    agentConfig.workflowBindings.map(async (slug) => {
      const result: unknown = await ctx.runAction(
        internal.workflows.file_actions.readWorkflowForExecution,
        { orgSlug, workflowSlug: slug },
      );

      if (!isRecord(result) || result.ok !== true) {
        return null;
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig shape
      const config = result.config as {
        name: string;
        description?: string;
        steps: Array<{ stepType: string; config?: unknown }>;
      };

      const startStep = config.steps.find((s) => s.stepType === 'start');
      const inputSchema = extractInputSchema(startStep?.config);

      const toolKey = `workflow_${snakeCase(slug)}`;
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
  handler: async (ctx, args) => {
    const { threadId, promptMessage, contextMessagesTokens } = args;

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

    const promptContent = await buildTodosPromptAugmentation(
      ctx,
      threadId,
      promptMessage,
    );

    return { promptContent, contextExceedsBudget };
  },
});

async function buildTodosPromptAugmentation(
  ctx: ActionCtx,
  threadId: string,
  promptMessage: string,
): Promise<string | undefined> {
  const threadMetadata = await ctx.runQuery(
    internal.threads.internal_queries.getThreadMetadata,
    { threadId },
  );
  const organizationId = threadMetadata?.organizationId;
  if (!organizationId) return undefined;

  const todosRecord = await ctx.runQuery(
    internal.thread_todos.internal_queries.getByThread,
    { organizationId, threadId },
  );
  if (!todosRecord || todosRecord.todos.length === 0) return undefined;

  const formatted = formatTodosForReminder(todosRecord.todos);
  const activeLine = todosRecord.activeTodoId
    ? `Active todo: ${todosRecord.activeTodoId}.`
    : 'No todo is currently in_progress. Pick one or create new todos before acting.';
  const reminder =
    `<system-reminder>\n` +
    `Research plan state (persisted, user-visible):\n` +
    `${formatted}\n` +
    `${activeLine}\n` +
    `Integration calls so far: ${todosRecord.integrationCallCount}.\n` +
    `Continue from the in_progress todo before starting new work. If none is active, mark the next pending one in_progress before searching.\n` +
    `</system-reminder>`;

  return promptMessage ? `${promptMessage}\n\n${reminder}` : reminder;
}

function formatTodosReminderMarker(
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled',
): string {
  switch (status) {
    case 'done':
      return '[x]';
    case 'in_progress':
      return '[~]';
    case 'failed':
      return '[!]';
    case 'cancelled':
      return '[-]';
    case 'pending':
    default:
      return '[ ]';
  }
}

interface TodoSourceLike {
  url: string;
  title?: string;
  score?: number;
  publishedDate?: string;
  capturedAt: number;
}

function collectUniqueSources(
  todos: Array<{ sources?: TodoSourceLike[] }>,
): Array<{ url: string; title?: string }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; title?: string }> = [];
  for (const todo of todos) {
    for (const src of todo.sources ?? []) {
      if (!src.url || seen.has(src.url)) continue;
      seen.add(src.url);
      out.push({ url: src.url, title: src.title });
    }
  }
  return out;
}

/**
 * Percent-decode URL for display. Many sources are Baidu/CJK URLs with heavy
 * hex-encoded paths — raw they read as noise, decoded they render natural
 * Chinese text. The href stays the original encoded URL so the link resolves.
 */
function prettifyUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

function formatTodosForReminder(
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
    findingsSummary?: string;
    failureReason?: string;
  }>,
): string {
  return todos
    .map((todo) => {
      const marker = formatTodosReminderMarker(todo.status);
      const findings = todo.findingsSummary ? ` — ${todo.findingsSummary}` : '';
      const failure =
        todo.status === 'failed' && todo.failureReason
          ? ` (failed: ${todo.failureReason})`
          : '';
      return `${marker} [${todo.id}] ${todo.content}${findings}${failure}`;
    })
    .join('\n');
}

/**
 * Guaranteed-synthesis fallback. Runs after the agent finishes generation.
 * If the agent maintained todos but the final message is missing a
 * [[CONCLUSION]] marker, append a deterministic summary so the user always
 * gets a cited report from completed todos — never silence.
 */
export const afterGenerateHook = internalAction({
  args: {
    threadId: v.string(),
    result: v.object({
      text: v.optional(v.string()),
      usage: v.optional(v.any()),
      durationMs: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { threadId, result } = args;
    const finalText = typeof result.text === 'string' ? result.text : '';
    if (finalText.includes('[[CONCLUSION]]')) {
      return null;
    }

    const waitingForHuman = await ctx.runQuery(
      internal.approvals.internal_queries.hasPendingHumanInputForThread,
      { threadId },
    );
    if (waitingForHuman) {
      return null;
    }

    const threadMetadata = await ctx.runQuery(
      internal.threads.internal_queries.getThreadMetadata,
      { threadId },
    );
    const organizationId = threadMetadata?.organizationId;
    if (!organizationId) return null;

    const todosRecord = await ctx.runQuery(
      internal.thread_todos.internal_queries.getByThread,
      { organizationId, threadId },
    );
    if (!todosRecord || todosRecord.todos.length === 0) return null;

    const done = todosRecord.todos.filter((t) => t.status === 'done');
    const failed = todosRecord.todos.filter((t) => t.status === 'failed');
    const inProgress = todosRecord.todos.filter(
      (t) => t.status === 'in_progress',
    );
    const pending = todosRecord.todos.filter((t) => t.status === 'pending');

    const lines: string[] = [];
    lines.push('[[CONCLUSION]]');
    if (done.length === 0) {
      lines.push(
        'The research run ended before I could reach a conclusion. The plan below shows where things stood — send a follow-up to continue or narrow the scope.',
      );
    } else {
      lines.push(
        `Summary of findings from ${done.length}/${todosRecord.todos.length} completed todos. The research run ended before a full synthesis could be written — see the key points and details below for what was gathered.`,
      );
    }
    if (done.length > 0) {
      lines.push('', '[[KEY_POINTS]]');
      for (const todo of done) {
        const findings =
          todo.findingsSummary && todo.findingsSummary.trim().length > 0
            ? todo.findingsSummary.trim()
            : todo.content;
        lines.push(`- ${findings}`);
      }
    }
    if (failed.length > 0 || inProgress.length > 0 || pending.length > 0) {
      lines.push('', '[[DETAILS]]');
      if (failed.length > 0) {
        lines.push('Failed todos:');
        for (const todo of failed) {
          const reason = todo.failureReason ?? 'unknown reason';
          lines.push(`- ${todo.content} (${reason})`);
        }
      }
      if (inProgress.length > 0) {
        lines.push('In progress when the run ended:');
        for (const todo of inProgress) {
          lines.push(`- ${todo.content}`);
        }
      }
      if (pending.length > 0) {
        lines.push('Not yet started:');
        for (const todo of pending) {
          lines.push(`- ${todo.content}`);
        }
      }
    }

    const aggregatedSources = collectUniqueSources(todosRecord.todos);
    if (aggregatedSources.length > 0) {
      lines.push('', 'Sources:');
      for (const src of aggregatedSources) {
        const label =
          src.title && src.title.length > 0 ? src.title : prettifyUrl(src.url);
        lines.push(`- [${label}](${src.url})`);
      }
    }

    lines.push(
      '',
      '_This summary was auto-generated from the research plan state. Ask a follow-up to investigate further._',
    );

    await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: 'assistant',
        content: lines.join('\n'),
      },
    });
    return null;
  },
});
