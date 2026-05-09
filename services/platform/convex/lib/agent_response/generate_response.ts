'use node';

/**
 * Generic Agent Response Generator
 *
 * This module provides a unified implementation for generating agent responses.
 * All agents (chat, web, file, crm, integration, workflow) use this shared
 * implementation with their specific configuration.
 *
 * Features:
 * - Supports both generateText (sub-agents) and streamText (chat agent)
 * - Hooks system for customizing the pipeline (beforeContext, beforeGenerate, afterGenerate)
 * - Automatic tool call extraction and tool usage tracking
 * - Context window building and token estimation
 */

import {
  abortStream,
  listMessages,
  listStreams,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';
import type { StreamMessage } from '@convex-dev/agent/validators';
import type { ModelMessage } from 'ai';
import { ConvexError } from 'convex/values';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { queryRagContext } from '../../agent_tools/rag/query_rag_context';
import { queryWebContext } from '../../agent_tools/web/helpers/query_web_context';
import { estimateCostCents } from '../../governance/cost_estimation';
import {
  finalizeSanitize,
  loadGuardrailsSnapshot,
  type GuardrailsSnapshot,
} from '../../governance/sanitize';
import {
  createGuardrailsTransform,
  makeInitialState,
  type BlockedReason,
  type GuardrailsTransformState,
} from '../../governance/stream_transform';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { recordFailure, recordSuccess } from '../../providers/circuit_breaker';
import {
  ProviderUnavailableError,
  isTransientProviderError,
} from '../../providers/errors';
import { onAgentComplete } from '../agent_completion';
import {
  buildStructuredContext,
  AGENT_CONTEXT_CONFIGS,
  RECOVERY_TIMEOUT_MS,
  estimateTokens,
} from '../context_management';
import { buildArtifactsContext } from '../context_management/build_artifacts_context';
import { wrapInDetails } from '../context_management/message_formatter';
import { createDebugLog } from '../debug_log';
import { summarizeForLog } from '../log_redact';
import { buildSystemPrompt } from './build_system_prompt';
import {
  buildUserPersonalization,
  type UserPersonalization,
} from './build_user_personalization';

const OUTPUT_BLOCKED_SENTINEL = '[blocked by content policy]';

function convexErrorToBlockedReason(err: unknown): BlockedReason | null {
  if (!(err instanceof ConvexError)) return null;
  const data: unknown = err.data;
  if (!isRecord(data)) return null;
  const code = data['code'];
  if (
    code !== 'chat_filter.blocked' &&
    code !== 'moderation_provider.blocked'
  ) {
    return null;
  }
  const direction = data['direction'];
  if (direction !== 'input' && direction !== 'output') return null;
  const categoryIds = data['categoryIds'];
  if (!Array.isArray(categoryIds)) return null;
  const runId = data['sanitizationRunId'];
  if (typeof runId !== 'string') return null;
  return {
    code,
    direction,
    categoryIds: categoryIds.filter((c): c is string => typeof c === 'string'),
    sanitizationRunId: runId,
  };
}

async function applyGuardrailsBlockTombstone(
  ctx: GenerateResponseArgs['ctx'],
  savedMessageId: string | undefined,
  streamId: string | undefined,
  threadId: string,
  reason: BlockedReason,
): Promise<void> {
  if (savedMessageId) {
    try {
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: savedMessageId,
        patch: {
          message: {
            role: 'assistant',
            content: OUTPUT_BLOCKED_SENTINEL,
          },
        },
      });
    } catch (err) {
      console.warn(
        `[guardrails] tombstone updateMessage failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      await ctx.runMutation(
        internal.message_metadata.internal_mutations.setBlockedReason,
        {
          messageId: savedMessageId,
          threadId,
          code: reason.code,
          direction: reason.direction,
          categoryIds: reason.categoryIds,
          sanitizationRunId: reason.sanitizationRunId,
        },
      );
    } catch (err) {
      console.warn(
        `[guardrails] setBlockedReason failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (streamId) {
    try {
      await ctx.runMutation(components.agent.streams.abort, {
        streamId,
        reason: 'blocked_by_content_policy',
      });
    } catch (err) {
      console.warn(
        `[guardrails] streams.abort failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

function buildBlockedReturn(
  threadId: string,
  savedMessageId: string | undefined,
  usage: GenerateResponseResult['usage'] | undefined,
  finishReason: string | undefined,
  startTime: number,
): GenerateResponseResult {
  return {
    threadId,
    text: OUTPUT_BLOCKED_SENTINEL,
    savedMessageId,
    usage,
    finishReason: finishReason ?? 'content-filter',
    durationMs: Date.now() - startTime,
  };
}
import { resolveTemplateVariables } from './resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from './structured_response_instructions';
import type {
  GenerateResponseConfig,
  GenerateResponseArgs,
  GenerateResponseResult,
  BeforeContextResult,
} from './types';
import { AgentTimeoutError, withTimeout } from './with_timeout';

/**
 * Fallback timeout ceiling when no explicit deadline is provided.
 * Only used as a cap for the no-deadline path (e.g. direct
 * generateAgentResponse calls without a propagated deadlineMs).
 * When deadlineMs IS provided (from startAgentChat or sub-agent
 * delegation), it is trusted directly since it was already computed
 * from the agent's configured timeoutMs.
 */
const PLATFORM_HARD_LIMIT_MS = 540_000;

/**
 * How often the abort watcher polls the stream status (ms).
 */
const ABORT_POLL_INTERVAL_MS = 1500;

interface AbortWatcher {
  stop: () => void;
  readonly cancelled: boolean;
}

/**
 * Polls for cancellation and aborts the controller when detected.
 * Bridges the gap between the `cancelGeneration` mutation (which sets DB
 * flags) and the running action (which needs an AbortSignal).
 *
 * Two detection methods:
 * - Check 1: new aborted SDK streams (mid-stream cancellation)
 * - Check 2: `cancelledAt` on threadMetadata (early cancellation, before
 *   any SDK stream exists)
 *
 * `baselineAbortedIds` filters out streams aborted before this generation.
 * `generationStartTime` distinguishes stale `cancelledAt` from current.
 */
function startAbortWatcher(
  ctx: GenerateResponseArgs['ctx'],
  threadId: string,
  abortController: AbortController,
  baselineAbortedIds: Set<string>,
  generationStartTime: number,
): AbortWatcher {
  let stopped = false;
  let cancelledByWatcher = false;

  const check = async () => {
    if (stopped || abortController.signal.aborted) return;
    try {
      // Check 1: new aborted streams (mid-stream cancellation)
      const streams = await ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ['aborted'] as const,
      });
      const hasNewAbort = streams.some(
        (s: { streamId: string }) => !baselineAbortedIds.has(s.streamId),
      );
      if (hasNewAbort) {
        cancelledByWatcher = true;
        abortController.abort();
        return;
      }

      // Check 2: cancelledAt on threadMetadata (early + universal)
      const meta = await ctx.runQuery(
        internal.threads.internal_queries.getThreadMetadata,
        { threadId },
      );
      if (meta?.cancelledAt && meta.cancelledAt >= generationStartTime) {
        cancelledByWatcher = true;
        abortController.abort();
        return;
      }
    } catch (pollError) {
      console.error('[abortWatcher] Poll failed:', pollError);
    }
    if (!stopped && !abortController.signal.aborted) {
      setTimeout(check, ABORT_POLL_INTERVAL_MS);
    }
  };

  setTimeout(check, ABORT_POLL_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
    },
    get cancelled() {
      return cancelledByWatcher;
    },
  };
}

/**
 * Find the first assistant message in the latest response order group and
 * link any pending approvals to it. Pending approvals are queried by
 * threadId but only rendered in the UI once their messageId field is set,
 * so this must complete BEFORE clearGenerationStatus or the user sees the
 * spinner stop, then a "approve this action" panel pop in a beat later.
 *
 * Wrapped in try/catch — approval linking is non-fatal.
 */
async function linkApprovalsToLatestAssistantMessage(
  ctx: GenerateResponseArgs['ctx'],
  threadId: string,
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  try {
    const messagesResult = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor: null, numItems: 50 },
      excludeToolMessages: false,
    });

    // Find the first assistant message in the current response order group.
    // We must link to an assistant message (not tool messages) because the UI
    // only loads user/assistant messages — tool message IDs are not in the
    // rendered message set and approvals linked to them would be invisible.
    const latestAssistantMessage = messagesResult.page.find(
      (m: MessageDoc) => m.message?.role === 'assistant',
    );
    if (!latestAssistantMessage) return;

    const currentOrder = latestAssistantMessage.order;
    const firstAssistantInOrder =
      messagesResult.page
        .filter(
          (m: MessageDoc) =>
            m.order === currentOrder && m.message?.role === 'assistant',
        )
        .sort((a: MessageDoc, b: MessageDoc) => a.stepOrder - b.stepOrder)[0] ??
      latestAssistantMessage;

    const linkedCount = await ctx.runMutation(
      internal.approvals.internal_mutations.linkApprovalsToMessage,
      {
        threadId,
        messageId: firstAssistantInOrder._id,
      },
    );
    if (linkedCount > 0) {
      debugLog(
        `Linked ${linkedCount} pending approvals to message ${firstAssistantInOrder._id}`,
      );
    }
  } catch (error) {
    console.error(
      '[generateAgentResponse] Failed to link approvals to message:',
      error,
    );
  }
}

/**
 * Finalize the persistent text stream after a successful generation. The
 * Agent SDK's DeltaStreamer already delivered text to the client in real
 * time; this only updates the persistent stream document used for refresh
 * recovery and HTTP polling. Non-fatal: if the stream is in a terminal
 * state from a prior fallback attempt, these mutations may fail and that
 * must not turn a successful response into a failure.
 *
 * When `cancelled` is true, only `completeStream` is called (no append) —
 * content was already streamed via the SDK before the abort.
 */
async function finalizePersistentStream(
  ctx: GenerateResponseArgs['ctx'],
  streamId: string,
  text: string,
  cancelled: boolean,
): Promise<void> {
  try {
    if (!cancelled && text) {
      await ctx.runMutation(
        internal.streaming.internal_mutations.appendToStream,
        { streamId, text },
      );
    }
    await ctx.runMutation(
      internal.streaming.internal_mutations.completeStream,
      { streamId },
    );
  } catch (streamError) {
    console.error(
      '[generateAgentResponse] Persistent stream finalization failed (non-fatal):',
      streamError,
    );
  }
}

/**
 * Generate an agent response using the provided configuration.
 *
 * This is the core implementation shared by all agents.
 * Each agent provides its specific configuration (agent factory, model, etc.)
 * and this function handles the common logic:
 * 1. Call beforeContext hook (optional)
 * 2. Build structured context
 * 3. Call beforeGenerate hook (optional)
 * 4. Generate response (streaming or non-streaming)
 * 5. Extract tool calls and sub-agent usage
 * 6. Call afterGenerate hook (optional)
 * 7. Save completion metadata
 */
export async function generateAgentResponse(
  config: GenerateResponseConfig,
  args: GenerateResponseArgs,
): Promise<GenerateResponseResult> {
  const {
    agentType,
    createAgent,
    model,
    provider,
    debugTag,
    enableStreaming,
    hooks,
    knowledgeMode: configKnowledgeMode,
    webSearchMode: configWebSearchMode,
    includeTeamKnowledge,
    includeOrgKnowledge,
    agentTeamId,
    agentTeamIds,
    knowledgeFileIds,
    structuredResponsesEnabled,
    instructions,
    toolsSummary,
    personalizationMode,
  } = config;
  const {
    ctx,
    threadId,
    userId,
    organizationId,
    promptMessage,
    additionalContext,
    userContext,
    agentSlug,
    teamIds,
    providerCost,
    parentThreadId,
    agentOptions,
    streamId,
    promptMessageId,
    maxSteps: _maxSteps,
    generationParams,
    suppressErrorCleanup,
  } = args;

  const debugLog = createDebugLog(
    `DEBUG_${agentType.toUpperCase()}_AGENT`,
    debugTag,
  );
  const startTime = Date.now();
  const abortController = new AbortController();

  // Declared outside try so the catch block can access them for cleanup/metadata
  let abortWatcher: AbortWatcher | undefined;
  let baselineAbortedIds = new Set<string>();

  // Hoisted so partial data is available in the catch block for error metadata
  let structuredThreadContext:
    | {
        threadContext: string;
        stats: {
          totalTokens: number;
          messageCount: number;
          approvalCount: number;
          hasRag: boolean;
          hasWebContext: boolean;
        };
      }
    | undefined;
  let agentInstructions: string | undefined;
  let retrySystemMessageId: string | undefined;
  let firstTokenTime: number | null = null;
  let savedMessageId: string | undefined;
  // Accumulator for every saved-message envelope returned across the
  // stream / generate / continue / recovery code paths. Used after
  // generation to resolve (toolCallId → messageId) for `propose_memory`
  // proposals whose `pendingToolCallId` still needs an anchor message.
  const allSavedMessages: unknown[] = [];
  // Guardrails output-filter state. Populated whether streaming or not;
  // the streaming transform writes into `guardrailsState` on block, and
  // `persistAssistantMessage` below uses that + the snapshot to tombstone
  // the saved assistant message with `blockedReason`.
  let guardrailsSnapshot: GuardrailsSnapshot | null = null;
  const guardrailsState: GuardrailsTransformState = makeInitialState();
  let resolvedOrgSlug: string | null = null;
  let result: {
    text?: string;
    steps?: unknown[];
    usage?: GenerateResponseResult['usage'];
    finishReason?: string;
    response?: { modelId?: string };
  } = {};

  try {
    debugLog(`generate${capitalize(agentType)}Response called`, {
      threadId,
      userId,
      organizationId,
      hasParentThread: !!parentThreadId,
      additionalContextKeys: additionalContext
        ? Object.keys(additionalContext)
        : [],
      enableStreaming,
    });

    // Start stream if streamId provided
    if (streamId) {
      await ctx.runMutation(internal.streaming.internal_mutations.startStream, {
        streamId,
      });
    }

    // Snapshot existing aborted streams so the watcher can distinguish
    // stale state from new cancellations.
    if (enableStreaming) {
      try {
        const existing = await ctx.runQuery(components.agent.streams.list, {
          threadId,
          statuses: ['aborted'] as const,
        });
        baselineAbortedIds = new Set(
          existing.map((s: { streamId: string }) => s.streamId),
        );
      } catch (baselineError) {
        console.error(
          '[generateAgentResponse] Baseline snapshot failed:',
          baselineError,
        );
      }
    }

    // Start abort watcher for streaming mode — polls stream status and
    // threadMetadata.cancelledAt, triggers abortController on cancellation.
    abortWatcher = enableStreaming
      ? startAbortWatcher(
          ctx,
          threadId,
          abortController,
          baselineAbortedIds,
          startTime,
        )
      : undefined;

    // Direct DB check for cancellation — closes the polling gap
    // that abortWatcher?.cancelled can miss. Returns the cancelledMessageId
    // when cancelled (avoids a redundant query in cancelledReturn).
    const checkCancelled = async (): Promise<
      false | { cancelledMessageId?: string }
    > => {
      if (abortWatcher?.cancelled) return {};
      try {
        // Check cancelledAt on threadMetadata
        const meta = await ctx.runQuery(
          internal.threads.internal_queries.getThreadMetadata,
          { threadId },
        );
        if (meta?.cancelledAt && meta.cancelledAt >= startTime) {
          return { cancelledMessageId: meta.cancelledMessageId };
        }
        // Check aborted SDK streams
        const streams = await ctx.runQuery(components.agent.streams.list, {
          threadId,
          statuses: ['aborted'] as const,
        });
        if (
          streams.some(
            (s: { streamId: string }) => !baselineAbortedIds.has(s.streamId),
          )
        ) {
          return { cancelledMessageId: meta?.cancelledMessageId };
        }
        return false;
      } catch (checkError) {
        console.error(
          '[generateAgentResponse] checkCancelled failed:',
          checkError,
        );
        return false;
      }
    };

    // Helper: complete persistent stream, save partial metadata, return cancelled result.
    // Accepts cancelledMessageId from checkCancelled to avoid a redundant DB query.
    const cancelledReturn = async (
      cancelledMessageId?: string,
    ): Promise<GenerateResponseResult> => {
      abortWatcher?.stop();
      if (streamId) {
        try {
          await ctx.runMutation(
            internal.streaming.internal_mutations.completeStream,
            { streamId },
          );
        } catch (streamError) {
          console.error(
            '[generateAgentResponse] cancelledReturn stream cleanup failed:',
            streamError,
          );
        }
      }
      // Resolve savedMessageId from cancelGeneration if we didn't capture it
      if (!savedMessageId && cancelledMessageId) {
        savedMessageId = cancelledMessageId;
      }

      const durationMs = Date.now() - startTime;
      const actualModel = result.response?.modelId ?? model;

      // Save metadata even on cancel — include context if it was built before cancellation
      if (savedMessageId) {
        try {
          let cancelContextWindow: string | undefined;
          let cancelContextStats: typeof structuredThreadContext extends undefined
            ? undefined
            :
                | (NonNullable<typeof structuredThreadContext>['stats'] & {
                    totalTokens: number;
                  })
                | undefined;

          if (structuredThreadContext) {
            const parts = [];
            if (agentInstructions) {
              parts.push(wrapInDetails('📋 System Prompt', agentInstructions));
            }
            if (toolsSummary) {
              parts.push(wrapInDetails('🔧 Tools', toolsSummary));
            }
            parts.push(structuredThreadContext.threadContext);
            cancelContextWindow = parts.join('\n\n');

            const sysTokens = instructions ? estimateTokens(instructions) : 0;
            const toolTokens = toolsSummary ? estimateTokens(toolsSummary) : 0;
            cancelContextStats = {
              ...structuredThreadContext.stats,
              totalTokens:
                structuredThreadContext.stats.totalTokens +
                sysTokens +
                toolTokens,
            };
          }

          await onAgentComplete(ctx, {
            threadId,
            agentType,
            result: {
              threadId,
              messageId: savedMessageId,
              text: result.text || '',
              model: actualModel,
              provider,
              usage: result.usage,
              durationMs,
              contextWindow: cancelContextWindow,
              contextStats: cancelContextStats,
            },
            organizationId,
            userId,
            teamIds,
            agentSlug,
            providerCost,
          });
        } catch (metaError) {
          console.error(
            '[generateAgentResponse] Failed to save cancel metadata:',
            metaError,
          );
        }
      }

      return {
        threadId,
        text: result.text || '',
        savedMessageId,
        durationMs,
        finishReason: 'cancelled',
        usage: result.usage,
        model: actualModel,
        provider,
      };
    };

    // Determine retrieval modes
    const knowledgeMode = configKnowledgeMode ?? 'off';
    const webSearchMode = configWebSearchMode ?? 'off';
    const needsKnowledgeContext =
      knowledgeMode === 'context' || knowledgeMode === 'both';
    const needsWebContext =
      webSearchMode === 'context' || webSearchMode === 'both';

    // Start context injection queries (non-blocking) for context/both modes
    let knowledgeContextPromise:
      | Promise<
          | import('../../agent_tools/rag/query_rag_context').RagContextResult
          | undefined
        >
      | undefined;
    if (needsKnowledgeContext && organizationId && promptMessage) {
      const accessibleFileIds: string[] = await ctx.runQuery(
        internal.documents.internal_queries.getAgentScopedFileIds,
        {
          organizationId,
          agentTeamId,
          agentTeamIds,
          includeTeamKnowledge,
          includeOrgKnowledge,
          knowledgeFileIds,
        },
      );
      if (accessibleFileIds.length === 0) {
        debugLog('No accessible RAG documents, skipping knowledge context');
      } else {
        knowledgeContextPromise = queryRagContext(
          promptMessage,
          undefined,
          undefined,
          undefined,
          undefined,
          { fileIds: accessibleFileIds },
        );
        debugLog('Knowledge context query started', {
          threadId,
          elapsedMs: Date.now() - startTime,
        });
      }
    }

    let webContextPromise:
      | Promise<
          | import('../../agent_tools/web/helpers/query_web_context').WebContextResult
          | undefined
        >
      | undefined;
    if (needsWebContext && organizationId && promptMessage) {
      webContextPromise = queryWebContext(ctx, organizationId, promptMessage);
      debugLog('Web context query started', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Per-user personalization (custom instructions + memories) runs in
    // parallel with knowledge/web so we don't add serial latency to TTFT.
    let userPersonalizationPromise: Promise<UserPersonalization> | undefined;
    if (userId && organizationId) {
      userPersonalizationPromise = buildUserPersonalization(ctx, {
        userId,
        organizationId,
        threadId,
        agentConfig: { personalizationMode },
      });
    }

    // Call beforeContext hook if provided
    let hookData: BeforeContextResult | undefined;
    if (hooks?.beforeContext) {
      hookData = await hooks.beforeContext(ctx, args);
      debugLog('beforeContext hook completed', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Await context injection results
    const [knowledgeContextResult, webContextResult, userPersonalization] =
      await Promise.all([
        knowledgeContextPromise ?? Promise.resolve(undefined),
        webContextPromise ?? Promise.resolve(undefined),
        userPersonalizationPromise ??
          Promise.resolve<UserPersonalization>({
            text: '',
            fingerprint: '',
            injectedMemoryIds: [],
            tokens: 0,
          }),
      ]);

    if (knowledgeContextResult) {
      debugLog('Knowledge context injected', {
        contextLength: knowledgeContextResult.text.length,
        citationCount: knowledgeContextResult.citations.length,
        elapsedMs: Date.now() - startTime,
      });
    }
    if (webContextResult) {
      debugLog('Web context injected', {
        contextLength: webContextResult.text.length,
        citationCount: webContextResult.citations.length,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Build structured context (history, RAG, web)
    // Note: promptMessage is NOT included - it's passed via `prompt` parameter
    const agentConfig = AGENT_CONTEXT_CONFIGS[agentType];
    const governanceMaxContext =
      config.maxContextTokens ?? args.maxContextTokens;
    const effectiveMaxHistoryTokens =
      governanceMaxContext != null &&
      Number.isFinite(governanceMaxContext) &&
      governanceMaxContext > 0
        ? Math.floor(
            Math.min(governanceMaxContext, agentConfig.maxHistoryTokens),
          )
        : agentConfig.maxHistoryTokens;

    if (governanceMaxContext) {
      debugLog('Governance context limit applied', {
        governanceLimit: governanceMaxContext,
        agentDefault: agentConfig.maxHistoryTokens,
        effective: effectiveMaxHistoryTokens,
      });
    }

    const contextBuildStart = Date.now();
    const artifactsContext = organizationId
      ? await buildArtifactsContext(ctx, organizationId, threadId)
      : undefined;
    structuredThreadContext = await buildStructuredContext({
      ctx,
      threadId,
      additionalContext,
      parentThreadId,
      maxHistoryTokens: effectiveMaxHistoryTokens,
      ragContext: knowledgeContextResult?.text ?? hookData?.ragContext,
      webContext: webContextResult?.text,
      artifactsContext,
      promptMessageId,
    });
    const contextBuildMs = Date.now() - contextBuildStart;

    debugLog('Context built', {
      estimatedTokens: structuredThreadContext.stats.totalTokens,
      messageCount: structuredThreadContext.stats.messageCount,
      contextBuildMs,
      elapsedMs: Date.now() - startTime,
    });

    // Multimodal prompt (e.g. inlined image parts for vision-capable models)
    // is the default in-flight prompt. The beforeGenerate hook may still
    // override it via `promptContent`.
    let hookPromptContent: string | ModelMessage[] | undefined =
      args.multiModalPrompt;

    // Call beforeGenerate hook if provided
    if (hooks?.beforeGenerate) {
      const beforeResult = await hooks.beforeGenerate(
        ctx,
        args,
        structuredThreadContext,
        hookData,
      );
      if (beforeResult.promptContent) {
        hookPromptContent = beforeResult.promptContent;
      }
      debugLog('beforeGenerate hook completed', {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Compute effective deadline.
    // When deadlineMs is provided (from startAgentChat or sub-agent delegation),
    // trust it directly — it was already computed from agentConfig.timeoutMs.
    // Only fall back to PLATFORM_HARD_LIMIT_MS when no deadline was propagated.
    const actionDeadline = args.deadlineMs
      ? Math.max(args.deadlineMs, Date.now() + 30_000)
      : Math.min(
          Date.now() + agentConfig.timeoutMs,
          startTime + PLATFORM_HARD_LIMIT_MS,
        );
    const effectiveTimeoutMs = Math.max(actionDeadline - Date.now(), 0);
    if (effectiveTimeoutMs <= 0) {
      throw new AgentTimeoutError(0);
    }

    // Create agent instance
    const agent = createAgent(agentOptions);

    // Build context with organization info.
    // actionDeadlineMs is exposed via variables so tool handlers can check remaining budget.
    const contextWithOrg = {
      ...ctx,
      organizationId,
      threadId,
      variables: { actionDeadlineMs: String(actionDeadline) },
      agentTeamId,
      agentTeamIds,
      includeTeamKnowledge,
      includeOrgKnowledge,
      knowledgeFileIds,
    };

    let didRetry = false;
    let retryInProgress = false;

    const promptToSend = hookPromptContent ?? promptMessage;

    // Resolve template variables (e.g. {{organization.name}}, {{current_time}})
    const resolvedInstructions = instructions
      ? await resolveTemplateVariables(ctx, instructions, {
          organizationId,
          userId,
          timezone: userContext?.timezone,
          language: userContext?.language,
        })
      : undefined;

    // Combine agent instructions with thread context for the system prompt.
    // The Agent SDK uses `system ?? this.options.instructions`, so when we pass
    // `system` explicitly the agent's own instructions are overridden.
    // We prepend them here so the LLM receives both the agent's identity/guidance
    // and the structured thread context (history, RAG, web search).
    // For streaming agents, append structured response instructions so the LLM
    // can optionally emit section markers (parsed by the frontend).
    agentInstructions =
      enableStreaming &&
      resolvedInstructions &&
      structuredResponsesEnabled === true
        ? `${resolvedInstructions}\n\n${STRUCTURED_RESPONSE_INSTRUCTIONS}`
        : resolvedInstructions;
    // System prompt order: agent identity → user personalization (custom
    // instructions + approved memories) → thread context. Personalization
    // sits between the stable agent prefix and the volatile thread tail so
    // it doesn't bust upstream prompt caches when memories don't change.
    const systemPrompt = buildSystemPrompt(
      agentInstructions,
      userPersonalization,
      structuredThreadContext.threadContext,
    );

    // Record the injection (one row per turn, with the IDs that were
    // folded into systemPrompt) so the data subject can later trace which
    // memories shaped a given response. Fire-and-forget — never blocks
    // the LLM call.
    if (
      userPersonalization.injectedMemoryIds.length > 0 &&
      organizationId &&
      userId
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.user_memory_audit_log.internal_mutations.appendAudit,
        {
          organizationId,
          actorUserId: userId,
          subjectUserId: userId,
          action: 'inject',
          outcome: 'ok',
          injectedMemoryIds: userPersonalization.injectedMemoryIds,
          threadId,
          messageId: promptMessageId ?? undefined,
          agentSlug: agentSlug ?? undefined,
        },
      );
    }

    debugLog('PRE_LLM_CALL', {
      threadId,
      model,
      enableStreaming,
      promptMessageId,
      system: summarizeForLog(systemPrompt),
      prompt: summarizeForLog(promptToSend),
      effectiveTimeoutMs,
      actionDeadline: new Date(actionDeadline).toISOString(),
      elapsedMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    // Snapshot guardrails configs once before LLM call; used by both the
    // streaming transform (if enabled) and by `finalizeSanitize` on the
    // full text at the end. Also resolves orgSlug which moderation needs
    // to locate the per-org SOPS secrets file.
    if (organizationId) {
      try {
        [guardrailsSnapshot, resolvedOrgSlug] = await Promise.all([
          loadGuardrailsSnapshot(ctx, organizationId),
          resolveOrgSlug(ctx, organizationId),
        ]);
      } catch (err) {
        console.warn(
          `[guardrails] failed to load snapshot for org ${organizationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const guardrailsOutputEnabled =
      guardrailsSnapshot !== null &&
      resolvedOrgSlug !== null &&
      ((guardrailsSnapshot.chatFilter?.enabled &&
        guardrailsSnapshot.chatFilter.config.appliesTo.includes('output')) ||
        guardrailsSnapshot.pii?.enabled ||
        (guardrailsSnapshot.moderation?.enabled &&
          guardrailsSnapshot.moderation.config.appliesTo.includes('output')));

    try {
      if (enableStreaming) {
        // Streaming mode (chat agent)
        // - system: thread context (history, RAG, web search)
        // - prompt: current user message (passed separately to avoid duplication)
        const transformRunId =
          guardrailsOutputEnabled && streamId
            ? `guardrails_${streamId}_${Date.now()}`
            : null;
        const outputTransform =
          guardrailsOutputEnabled &&
          guardrailsSnapshot !== null &&
          resolvedOrgSlug !== null &&
          transformRunId !== null &&
          streamId !== undefined
            ? (() => {
                const snapshot = guardrailsSnapshot;
                const orgSlug = resolvedOrgSlug;
                const sid = streamId;
                const runId = transformRunId;
                return ({ stopStream }: { stopStream: () => void }) =>
                  createGuardrailsTransform({
                    configs: snapshot,
                    direction: 'output',
                    sanitizationRunId: runId,
                    streamId: sid,
                    orgSlug,
                    organizationId,
                    state: guardrailsState,
                    stopStream,
                    defaultMaskReplacement:
                      snapshot.chatFilter?.config.maskReplacement ??
                      '[BLOCKED]',
                    runModerationForChunk: snapshot.moderation
                      ? async (text) => {
                          const modConfig = snapshot.moderation?.config;
                          if (!modConfig) return null;
                          return await ctx.runAction(
                            internal.governance.moderation_provider
                              .internal_actions.runModerationProviderAction,
                            {
                              organizationId,
                              orgSlug,
                              direction: 'output',
                              text,
                              endpoint: modConfig.endpoint,
                              responseShape: modConfig.responseShape,
                              categoryMappings: modConfig.categoryMappings,
                              failBehavior: modConfig.failBehavior,
                            },
                          );
                        }
                      : undefined,
                  });
              })()
            : null;

        const streamResult = await agent.streamText(
          contextWithOrg,
          { threadId, userId },
          {
            promptMessageId,
            system: systemPrompt,
            prompt: promptToSend,
            abortSignal: abortController.signal,
            ...(outputTransform !== null && {
              experimental_transform: outputTransform,
            }),
            ...(generationParams?.temperature != null && {
              temperature: generationParams.temperature,
            }),
            ...(generationParams?.maxTokens != null && {
              maxTokens: generationParams.maxTokens,
            }),
            ...(generationParams?.topP != null && {
              topP: generationParams.topP,
            }),
            ...(generationParams?.frequencyPenalty != null && {
              frequencyPenalty: generationParams.frequencyPenalty,
            }),
            ...(generationParams?.presencePenalty != null && {
              presencePenalty: generationParams.presencePenalty,
            }),
            ...(generationParams?.stopSequences != null && {
              stopSequences: generationParams.stopSequences,
            }),
            onChunk: ({ chunk }: { chunk: { type: string } }) => {
              if (firstTokenTime === null && chunk.type === 'text-delta') {
                firstTokenTime = Date.now();
              }
            },
          },
          {
            contextOptions: {
              recentMessages: 0,
              excludeToolMessages: true,
              searchOtherThreads: false,
            },
            saveStreamDeltas: { throttleMs: 100, chunking: /[\p{P}\s]/u },
          },
        );

        savedMessageId = streamResult.savedMessages?.[0]?._id;
        if (Array.isArray(streamResult.savedMessages)) {
          allSavedMessages.push(...streamResult.savedMessages);
        }

        // Wait for stream to complete (with timeout)
        const [
          streamText,
          streamSteps,
          streamUsage,
          streamFinishReason,
          streamResponse,
        ] = await withTimeout(
          Promise.all([
            streamResult.text,
            streamResult.steps,
            streamResult.usage,
            streamResult.finishReason,
            streamResult.response,
          ]),
          effectiveTimeoutMs,
          abortController,
        );

        debugLog('Stream completed', {
          threadId,
          elapsedMs: Date.now() - startTime,
        });

        result = {
          text: streamText,
          steps: streamSteps,
          usage: streamUsage,
          finishReason: streamFinishReason,
          response: streamResponse,
        };

        // Guardrails mid-stream block: transform flipped state.blocked and
        // called stopStream(). That stops the LLM, but deltas already
        // persisted via saveStreamDeltas remain on disk. Tombstone the
        // saved message so reload / history-builder see the sentinel, not
        // the partial violating text.
        if (guardrailsState.blocked && guardrailsState.blockedReason) {
          await applyGuardrailsBlockTombstone(
            ctx,
            savedMessageId,
            streamId,
            threadId,
            guardrailsState.blockedReason,
          );
          result.text = OUTPUT_BLOCKED_SENTINEL;
          // Skip the empty-output-provider-error heuristic below: empty
          // text is now expected.
          return buildBlockedReturn(
            threadId,
            savedMessageId,
            streamUsage,
            streamFinishReason,
            startTime,
          );
        }

        // Detect stream-level provider errors: the stream completed "successfully"
        // at the transport level but produced no output and no steps — the error
        // is only recorded in the stream deltas. Throw so the catch block can
        // save a proper failed message for the user.
        if (
          !streamText?.trim() &&
          (!streamSteps || streamSteps.length === 0) &&
          streamFinishReason !== 'stop'
        ) {
          throw new Error(
            `Generation produced no output (finishReason: ${streamFinishReason ?? 'undefined'})`,
          );
        }

        // Finalize sweep: run chat_filter + PII on the full accumulated
        // text to catch cross-chunk matches the per-delta pass missed.
        // Moderation is NOT re-run here — it already scanned its byte-
        // capped buffers during the stream. If the sweep blocks, tombstone
        // just like a mid-stream block. If it rewrites (mask), overwrite
        // the saved message text so reload shows the clean version.
        if (
          guardrailsOutputEnabled &&
          guardrailsSnapshot &&
          resolvedOrgSlug &&
          streamText &&
          streamText.trim().length > 0
        ) {
          try {
            const finalized = await finalizeSanitize(
              ctx,
              streamText,
              guardrailsSnapshot,
              {
                organizationId,
                orgSlug: resolvedOrgSlug,
                threadId,
                messageId: savedMessageId,
                agentSlug,
                actorType: 'assistant',
              },
            );
            if (finalized.text !== streamText) {
              result.text = finalized.text;
              if (savedMessageId) {
                try {
                  await ctx.runMutation(
                    components.agent.messages.updateMessage,
                    {
                      messageId: savedMessageId,
                      patch: {
                        message: {
                          role: 'assistant',
                          content: finalized.text,
                        },
                      },
                    },
                  );
                } catch (updateErr) {
                  console.warn(
                    `[guardrails] finalize-mask update failed: ${
                      updateErr instanceof Error
                        ? updateErr.message
                        : String(updateErr)
                    }`,
                  );
                }
              }
            }
          } catch (err) {
            // finalizeSanitize throws ConvexError on block — translate to
            // the tombstone flow.
            const blockedReason = convexErrorToBlockedReason(err);
            if (blockedReason) {
              await applyGuardrailsBlockTombstone(
                ctx,
                savedMessageId,
                streamId,
                threadId,
                blockedReason,
              );
              result.text = OUTPUT_BLOCKED_SENTINEL;
              return buildBlockedReturn(
                threadId,
                savedMessageId,
                streamUsage,
                streamFinishReason,
                startTime,
              );
            }
            throw err;
          }
        }

        // Post-success abort check: direct DB query closes the polling
        // gap that the watcher flag alone can miss.
        const cancelCheck = await checkCancelled();
        if (cancelCheck) {
          return cancelledReturn(cancelCheck.cancelledMessageId);
        }
      } else {
        // Non-streaming mode (sub-agents)
        // Extend context with all fields from contextWithOrg for consistency
        const subAgentContext = {
          ...ctx,
          organizationId,
          threadId,
          variables: { actionDeadlineMs: String(actionDeadline) },
          agentTeamId,
          agentTeamIds,
          includeTeamKnowledge,
          includeOrgKnowledge,
          knowledgeFileIds,
          ...(parentThreadId ? { parentThreadId } : {}),
        };

        const generateResult = await withTimeout(
          agent.generateText(
            subAgentContext,
            { threadId, userId },
            {
              system: systemPrompt,
              prompt: promptToSend,
              abortSignal: abortController.signal,
              ...(promptMessageId ? { promptMessageId } : {}),
              ...(generationParams?.temperature != null && {
                temperature: generationParams.temperature,
              }),
              ...(generationParams?.maxTokens != null && {
                maxTokens: generationParams.maxTokens,
              }),
              ...(generationParams?.topP != null && {
                topP: generationParams.topP,
              }),
              ...(generationParams?.frequencyPenalty != null && {
                frequencyPenalty: generationParams.frequencyPenalty,
              }),
              ...(generationParams?.presencePenalty != null && {
                presencePenalty: generationParams.presencePenalty,
              }),
              ...(generationParams?.stopSequences != null && {
                stopSequences: generationParams.stopSequences,
              }),
            },
            {
              contextOptions: {
                recentMessages: 0,
                excludeToolMessages: false,
              },
            },
          ),
          effectiveTimeoutMs,
          abortController,
        );

        savedMessageId = generateResult.savedMessages?.[0]?._id;
        if (Array.isArray(generateResult.savedMessages)) {
          allSavedMessages.push(...generateResult.savedMessages);
        }

        debugLog('Generate completed', {
          threadId,
          elapsedMs: Date.now() - startTime,
        });

        result = {
          text: generateResult.text,
          steps: generateResult.steps,
          usage: generateResult.usage,
          finishReason: generateResult.finishReason,
          response: generateResult.response,
        };

        // Post-generation abort check
        const cancelCheck = await checkCancelled();
        if (cancelCheck) {
          return cancelledReturn(cancelCheck.cancelledMessageId);
        }
      }

      // Unified continue: if finishReason is not "stop" (or other non-retryable),
      // rebuild context and generate a complete replacement response.
      const continueCheck = shouldRetryGeneration(
        result.finishReason,
        result.text,
        result.steps,
        didRetry,
      );
      if (continueCheck.retry) {
        const continueRemainingMs = actionDeadline - Date.now();
        if (continueRemainingMs < 30_000) {
          debugLog('Skipping continue, insufficient time remaining', {
            remainingMs: continueRemainingMs,
          });
        } else {
          const hasToolResults = needsToolResultRetry(
            result.text,
            result.steps,
          );
          debugLog('Continuing generation', {
            reason: continueCheck.reason,
            hasToolResults,
            finishReason: result.finishReason,
            textLength: result.text?.length ?? 0,
            stepsCount: result.steps?.length ?? 0,
          });

          const continueArtifactsContext = organizationId
            ? await buildArtifactsContext(ctx, organizationId, threadId)
            : undefined;
          const continueContext = await buildStructuredContext({
            ctx,
            threadId,
            additionalContext,
            parentThreadId,
            maxHistoryTokens: effectiveMaxHistoryTokens,
            ragContext: hookData?.ragContext,
            artifactsContext: continueArtifactsContext,
            promptMessageId,
          });

          const continueAgent = createAgent(agentOptions);

          const continueSystemPrompt = buildSystemPrompt(
            agentInstructions,
            userPersonalization,
            continueContext.threadContext,
          );

          const continuePrompt = hasToolResults
            ? promptMessage
              ? `Based on the tool results, complete this task: ${promptMessage}`
              : 'Based on the conversation and tool results above, provide your complete response.'
            : promptMessage
              ? `Please complete this task: ${promptMessage}`
              : 'Please provide a response based on the conversation above.';

          const recentMsgs = await listMessages(ctx, components.agent, {
            threadId,
            paginationOpts: { cursor: null, numItems: 10 },
            excludeToolMessages: true,
          });
          const originalUserMessage = recentMsgs.page.find(
            (m: MessageDoc) => m.message?.role === 'user',
          );

          const continueStartTime = Date.now();
          debugLog('Continue starting', {
            reason: continueCheck.reason,
            timeoutMs: continueRemainingMs,
            contextTokens: continueContext.stats.totalTokens,
            model,
            elapsedMs: continueStartTime - startTime,
          });

          const continueAbortController = new AbortController();
          if (abortController.signal.aborted) {
            continueAbortController.abort();
          } else {
            abortController.signal.addEventListener(
              'abort',
              () => continueAbortController.abort(),
              { once: true },
            );
          }

          // Build the appropriate context object for the continue call
          const continueCtx = enableStreaming
            ? contextWithOrg
            : {
                ...ctx,
                organizationId,
                threadId,
                variables: { actionDeadlineMs: String(actionDeadline) },
                agentTeamId,
                agentTeamIds,
                includeTeamKnowledge,
                includeOrgKnowledge,
                knowledgeFileIds,
                ...(parentThreadId ? { parentThreadId } : {}),
              };

          // Check for cancellation before starting continue (catches cancels during context building)
          {
            const cancelCheck = await checkCancelled();
            if (cancelCheck) {
              return cancelledReturn(cancelCheck.cancelledMessageId);
            }
          }

          // Save system message to record the continuation in thread history
          const retryMsg = await saveMessage(ctx, components.agent, {
            threadId,
            message: {
              role: 'system',
              content: '[RESPONSE_INTERRUPTED] Retrying…',
            },
          });
          retrySystemMessageId = retryMsg.messageId;

          // Prevent zombie detection during the gap before continuation saves its own message
          const originalSavedMessageId = savedMessageId;
          if (savedMessageId) {
            await ctx.runMutation(components.agent.messages.updateMessage, {
              messageId: savedMessageId,
              patch: { status: 'pending' },
            });
          }

          retryInProgress = true;
          try {
            const continueResult = await withTimeout(
              continueAgent.generateText(
                continueCtx,
                { threadId, userId },
                {
                  system: continueSystemPrompt,
                  prompt: continuePrompt,
                  abortSignal: continueAbortController.signal,
                  ...(originalUserMessage
                    ? { promptMessageId: originalUserMessage._id }
                    : {}),
                  ...(generationParams?.maxTokens != null && {
                    maxTokens: generationParams.maxTokens,
                  }),
                },
                {
                  contextOptions: {
                    recentMessages: 0,
                    excludeToolMessages: false,
                  },
                },
              ),
              continueRemainingMs,
              continueAbortController,
            );

            didRetry = true;
            // Capture continuation's saved message ID for downstream operations
            const continueSavedId = continueResult.savedMessages?.[0]?._id;
            if (continueSavedId) savedMessageId = continueSavedId;
            if (Array.isArray(continueResult.savedMessages)) {
              allSavedMessages.push(...continueResult.savedMessages);
            }

            result = {
              text: continueResult.text,
              steps: [...(result.steps || []), ...continueResult.steps],
              usage: mergeUsage(result.usage, continueResult.usage),
              finishReason: continueResult.finishReason,
              response: result.response,
            };

            // Update the "Retrying…" system message now that retry succeeded
            if (retrySystemMessageId) {
              try {
                await ctx.runMutation(components.agent.messages.updateMessage, {
                  messageId: retrySystemMessageId,
                  patch: {
                    message: {
                      role: 'system',
                      content: '[RESPONSE_INTERRUPTED] Retry succeeded',
                    },
                  },
                });
              } catch (updateError) {
                console.error(
                  '[generateAgentResponse] Failed to update retry system message on success:',
                  updateError,
                );
              }
              retrySystemMessageId = undefined;
            }

            debugLog('Continue completed', {
              reason: continueCheck.reason,
              textLength: result.text?.length ?? 0,
              finishReason: result.finishReason,
              continueDurationMs: Date.now() - continueStartTime,
            });
          } finally {
            retryInProgress = false;
            // ALWAYS restore original message status (handles all error paths)
            if (originalSavedMessageId) {
              try {
                await ctx.runMutation(components.agent.messages.updateMessage, {
                  messageId: originalSavedMessageId,
                  patch: { status: 'success' },
                });
              } catch (restoreError) {
                console.error(
                  '[generateAgentResponse] Failed to restore message status:',
                  restoreError,
                );
              }
            }
          }
        }
      }

      // Post-continue abort check
      {
        const cancelCheck = await checkCancelled();
        if (cancelCheck) {
          return cancelledReturn(cancelCheck.cancelledMessageId);
        }
      }

      // Fallback: if text is still missing after continue, provide a minimal response
      // so the user always sees something rather than an empty message
      if (
        !result.text?.trim() ||
        needsToolResultRetry(result.text, result.steps)
      ) {
        const toolNames = extractToolNamesFromSteps(result.steps ?? []);
        debugLog('All retries exhausted, using fallback message', {
          toolNames,
          finishReason: result.finishReason,
        });
        didRetry = true;
        result.text =
          toolNames.length > 0
            ? `I attempted to process your request using ${toolNames.join(', ')}, but was unable to generate a complete response. Please try again.`
            : 'I was unable to generate a response. Please try again.';
      }
    } catch (timeoutError) {
      if (!(timeoutError instanceof AgentTimeoutError)) throw timeoutError;

      // If the continue itself timed out, skip recovery and use fallback directly
      if (retryInProgress) {
        debugLog('Continue timed out, using fallback', {
          elapsedMs: Date.now() - startTime,
        });
        result = {
          text: '',
          finishReason: 'timeout-recovery-failed',
        };
        retryInProgress = false;
      } else {
        // Generation timed out — attempt recovery using available context + tool results
        debugLog('Generation timed out, attempting recovery', {
          timeoutMs: effectiveTimeoutMs,
          elapsedMs: Date.now() - startTime,
        });

        try {
          // Rebuild context — picks up any tool results saved before the timeout
          const recoveryContext = await buildStructuredContext({
            ctx,
            threadId,
            additionalContext,
            parentThreadId,
            maxHistoryTokens: effectiveMaxHistoryTokens,
            ragContext: hookData?.ragContext,
            promptMessageId,
          });

          const recoveryAgent = createAgent(agentOptions);

          const recoverySystemPrompt = buildSystemPrompt(
            agentInstructions,
            userPersonalization,
            recoveryContext.threadContext,
          );

          // Cap recovery timeout by action deadline
          const recoveryPlatformRemainingMs = Math.max(
            actionDeadline - Date.now(),
            0,
          );
          if (recoveryPlatformRemainingMs < 10_000) {
            throw new AgentTimeoutError(0);
          }
          const recoveryRemainingMs = Math.min(
            RECOVERY_TIMEOUT_MS,
            recoveryPlatformRemainingMs,
          );
          const recoveryStartTime = Date.now();
          debugLog('Timeout recovery starting', {
            timeoutMs: recoveryRemainingMs,
            contextTokens: recoveryContext.stats.totalTokens,
            model,
            elapsedMs: recoveryStartTime - startTime,
          });

          // Save system message to record the recovery in thread history
          await saveMessage(ctx, components.agent, {
            threadId,
            message: {
              role: 'system',
              content:
                '[TIMEOUT_RECOVERY] Previous attempt timed out. Recovering with available context.',
            },
          });

          // Prevent zombie detection during recovery
          const recoveryOriginalMessageId = savedMessageId;
          if (savedMessageId) {
            await ctx.runMutation(components.agent.messages.updateMessage, {
              messageId: savedMessageId,
              patch: { status: 'pending' },
            });
          }

          const recoveryAbortController = new AbortController();

          try {
            const recoveryResult = await withTimeout(
              recoveryAgent.generateText(
                contextWithOrg,
                { threadId, userId },
                {
                  system: recoverySystemPrompt,
                  prompt: promptMessage
                    ? `The previous attempt to respond timed out. Based on any available context and tool results, provide a helpful response to: ${promptMessage}`
                    : 'The previous attempt timed out. Based on the conversation and any available tool results, provide a summary response.',
                  abortSignal: recoveryAbortController.signal,
                },
                {
                  contextOptions: {
                    recentMessages: 0,
                    excludeToolMessages: false,
                    searchOtherThreads: false,
                  },
                },
              ),
              recoveryRemainingMs,
              recoveryAbortController,
            );

            didRetry = true;
            const recoverySavedId = recoveryResult.savedMessages?.[0]?._id;
            if (recoverySavedId) savedMessageId = recoverySavedId;
            if (Array.isArray(recoveryResult.savedMessages)) {
              allSavedMessages.push(...recoveryResult.savedMessages);
            }

            result = {
              text: recoveryResult.text,
              steps: recoveryResult.steps,
              usage: recoveryResult.usage,
              finishReason: 'timeout-recovery',
              response: recoveryResult.response,
            };

            debugLog('Timeout recovery completed', {
              textLength: result.text?.length ?? 0,
              retryDurationMs: Date.now() - recoveryStartTime,
              elapsedMs: Date.now() - startTime,
            });
          } finally {
            // ALWAYS restore original message status
            if (recoveryOriginalMessageId) {
              try {
                await ctx.runMutation(components.agent.messages.updateMessage, {
                  messageId: recoveryOriginalMessageId,
                  patch: { status: 'success' },
                });
              } catch (restoreError) {
                console.error(
                  '[generateAgentResponse] Failed to restore message status during recovery:',
                  restoreError,
                );
              }
            }
          }
        } catch (recoveryError) {
          // Recovery itself failed — use static fallback
          console.error(
            '[generateAgentResponse] Timeout recovery failed:',
            recoveryError,
          );

          didRetry = true;
          result = {
            text: 'I was unable to complete your request in time. Please try again.',
            finishReason: 'timeout-recovery-failed',
          };

          debugLog('Timeout recovery failed, using static fallback', {
            elapsedMs: Date.now() - startTime,
          });
        }
      } // close else (retryInProgress)
    }

    // Persist retry/fallback text to the saved message so it survives page reloads.
    // Retries use saveMessages: 'none', so the SDK-saved message still has the
    // original (empty/preamble) text. Update it with the final result.
    if (
      didRetry &&
      savedMessageId &&
      result.text &&
      !(await checkCancelled())
    ) {
      try {
        await ctx.runMutation(components.agent.messages.updateMessage, {
          messageId: savedMessageId,
          patch: {
            message: { role: 'assistant', content: result.text },
          },
        });
      } catch (updateError) {
        console.error(
          '[generateAgentResponse] updateMessage failed, saving new message:',
          updateError,
        );
        await saveMessage(ctx, components.agent, {
          threadId,
          message: { role: 'assistant', content: result.text },
        });
      }
    }

    // Record success in circuit breaker so it resets failure counts
    if (provider) {
      recordSuccess(provider, model);
    }

    const durationMs = Date.now() - startTime;
    const timeToFirstTokenMs = firstTokenTime
      ? firstTokenTime - startTime
      : undefined;

    debugLog('Response generated', {
      durationMs,
      textLength: result.text?.length ?? 0,
      finishReason: result.finishReason,
      stepsCount: result.steps?.length ?? 0,
      timeToFirstTokenMs,
    });

    // Structured performance summary for profiling (T0 instrumentation)
    debugLog('PERF_SUMMARY', {
      threadId,
      model,
      totalMs: durationMs,
      ttftMs: timeToFirstTokenMs,
      contextBuildMs,
      ragContextLength: knowledgeContextResult?.text?.length ?? 0,
      webContextLength: webContextResult?.text?.length ?? 0,
      contextTokens: structuredThreadContext.stats.totalTokens,
      messageCount: structuredThreadContext.stats.messageCount,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });

    // Resolve `propose_memory` proposals to their assistant message id.
    // The convex-agent SDK doesn't expose the assistant message id at
    // tool-execute time, so `writeProposal` stashes the AI SDK
    // `toolCallId` into `sourceMessageId`; here, after the SDK has
    // saved every assistant message of this turn, we walk
    // `allSavedMessages` for matching tool-call parts and overwrite
    // `sourceMessageId` with the real message id. Fire-and-forget —
    // the chat UI is reactive and an unresolved row simply doesn't
    // render an inline card (the user can still see it in
    // /settings/personalization).
    if (userId && organizationId) {
      const memoryMappings = extractToolCallMessageMapping(
        allSavedMessages,
        'propose_memory',
      );
      if (memoryMappings.length > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.user_memories.internal_mutations.resolveProposalMessageIds,
          {
            userId,
            organizationId,
            threadId,
            mappings: memoryMappings,
          },
        );
      }
    }

    // Extract tool calls from steps
    const {
      toolCalls,
      toolsUsage,
      citations: toolCitations,
    } = extractToolCallsFromSteps(result.steps ?? []);

    // Context-mode citations (known before generation, from RAG/web injection)
    const contextCitations = [
      ...(knowledgeContextResult?.citations ?? []),
      ...(webContextResult?.citations ?? []),
    ];

    // Simple selection: tool citations are authoritative when tools were called;
    // fall back to context citations when no tool calls produced citations.
    const citations =
      toolCitations.length > 0 ? toolCitations : contextCitations;

    // Build complete context window for metadata (uses <details> for collapsible display)
    const contextWindowParts = [];
    if (agentInstructions) {
      contextWindowParts.push(
        wrapInDetails('📋 System Prompt', agentInstructions),
      );
    }
    if (toolsSummary) {
      contextWindowParts.push(wrapInDetails('🔧 Tools', toolsSummary));
    }
    contextWindowParts.push(structuredThreadContext.threadContext);
    const completeContextWindow = contextWindowParts.join('\n\n');

    // Get actual model from response (no fallback to config)
    const actualModel = result.response?.modelId;

    // Augment context stats to include system prompt + tools tokens
    const systemPromptTokens = instructions ? estimateTokens(instructions) : 0;
    const toolsTokens = toolsSummary ? estimateTokens(toolsSummary) : 0;
    const contextStats = {
      ...structuredThreadContext.stats,
      totalTokens:
        structuredThreadContext.stats.totalTokens +
        systemPromptTokens +
        toolsTokens,
    };

    const responseResult: GenerateResponseResult = {
      threadId,
      text: result.text || '',
      usage: result.usage,
      finishReason: result.finishReason,
      durationMs,
      timeToFirstTokenMs,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolsUsage: toolsUsage.length > 0 ? toolsUsage : undefined,
      citations: citations.length > 0 ? citations : undefined,
      contextWindow: completeContextWindow,
      contextStats,
      model: actualModel,
      provider,
    };

    // Final abort check before post-processing — direct DB query
    // closes the polling gap the watcher alone can miss.
    {
      const cancelCheck = await checkCancelled();
      if (cancelCheck) {
        return cancelledReturn(cancelCheck.cancelledMessageId);
      }
    }

    // Call afterGenerate hook if provided
    if (hooks?.afterGenerate) {
      await hooks.afterGenerate(ctx, args, responseResult, hookData);
    }

    // Approvals must be linked BEFORE clearGenerationStatus. Pending approval
    // rows are loaded by threadId but only render in the UI once messageId is
    // patched (use-merged-chat-items checks loadedMessageIds). If the spinner
    // clears first, the user sees: spinner stops → blank gap → "approve this
    // action" panel pops in. Sub-agents skip — only main threads have UI.
    if (!parentThreadId && savedMessageId) {
      await linkApprovalsToLatestAssistantMessage(ctx, threadId, debugLog);
    }

    const cancelled = await checkCancelled();

    // Run the remaining post-processing in parallel — clearGenerationStatus
    // (the only operation the user perceives), onAgentComplete (metadata +
    // ledger + audit), and persistent stream finalization are all
    // independent. Wrapped in try/catch so a non-OCC throw from
    // clearGenerationStatus doesn't propagate into the outer catch (which
    // saves a "failed" message and would mis-classify a successful run).
    try {
      await Promise.all([
        streamId
          ? ctx.runMutation(
              internal.threads.internal_mutations.clearGenerationStatus,
              { threadId, streamId },
            )
          : Promise.resolve(),
        onAgentComplete(ctx, {
          threadId,
          agentType,
          result: {
            threadId,
            messageId: savedMessageId,
            text: responseResult.text,
            model: actualModel,
            provider,
            usage: responseResult.usage,
            durationMs,
            timeToFirstTokenMs,
            toolCalls: responseResult.toolCalls,
            toolsUsage: responseResult.toolsUsage,
            citations: responseResult.citations,
            contextWindow: completeContextWindow,
            contextStats: responseResult.contextStats,
          },
          organizationId,
          userId,
          teamIds,
          agentSlug,
          providerCost,
        }),
        streamId
          ? finalizePersistentStream(
              ctx,
              streamId,
              responseResult.text,
              !!cancelled,
            )
          : Promise.resolve(),
      ]);
    } catch (postProcessError) {
      console.error(
        '[generateAgentResponse] Post-processing failed (non-fatal):',
        postProcessError,
      );
    }

    abortWatcher?.stop();
    return responseResult;
  } catch (error) {
    abortWatcher?.stop();

    // Record transient provider failures in the circuit breaker
    if (provider) {
      const transientInfo = isTransientProviderError(error);
      if (transientInfo) {
        recordFailure(provider, model);
        debugLog('Circuit breaker: recorded failure', {
          provider,
          model,
          statusCode: transientInfo.statusCode,
          isTimeout: transientInfo.isTimeout,
        });

        if (
          error instanceof ProviderUnavailableError ||
          transientInfo.statusCode
        ) {
          throw new ProviderUnavailableError(
            `Provider ${provider} model ${model} unavailable`,
            provider,
            model,
            transientInfo.statusCode,
          );
        }
      }
    }

    const err = isRecord(error) ? error : { message: String(error) };
    const errorName = getString(err, 'name') ?? '';
    const errorMessage = getString(err, 'message') ?? '';

    console.error('[generateAgentResponse] ORIGINAL ERROR:', {
      name: errorName,
      message: errorMessage,
      code: getString(err, 'code'),
      status: err['status'],
      cause: err['cause'],
    });

    // State-driven cleanup: check DB state and act only if needed.
    // No heuristic error-message parsing — works regardless of cause.

    // Check cancelledAt on threadMetadata FIRST — this is the authoritative
    // signal for user cancellation. Aborted SDK streams alone are NOT
    // reliable: the SDK also aborts streams on provider errors (e.g. 403),
    // which would be misidentified as user cancellation.
    let userCancelled = false;
    let cancelMeta: {
      cancelledAt?: number;
      cancelledMessageId?: string;
    } | null = null;
    try {
      cancelMeta = await ctx.runQuery(
        internal.threads.internal_queries.getThreadMetadata,
        { threadId },
      );
      if (cancelMeta?.cancelledAt && cancelMeta.cancelledAt >= startTime) {
        userCancelled = true;
      }
    } catch (metaError) {
      console.error(
        '[generateAgentResponse] Failed to check cancelledAt:',
        metaError,
      );
    }

    // Secondary check: new aborted SDK streams confirm cancellation only
    // when thread metadata also indicates it, OR detect stuck streaming
    // streams for cleanup.
    let stuckStreams: StreamMessage[] = [];
    try {
      const allStreams = await listStreams(ctx, components.agent, {
        threadId,
        includeStatuses: ['aborted', 'streaming'],
      });
      if (
        !userCancelled &&
        allStreams.some(
          (s) => s.status === 'aborted' && !baselineAbortedIds.has(s.streamId),
        )
      ) {
        // Aborted stream found but no cancelledAt — this is an
        // error-abort (e.g. provider 403), NOT user cancellation.
        // Collect any still-streaming streams for cleanup.
        stuckStreams = allStreams.filter((s) => s.status === 'streaming');
      } else if (!userCancelled) {
        stuckStreams = allStreams.filter((s) => s.status === 'streaming');
      }
    } catch (streamQueryError) {
      console.error(
        '[generateAgentResponse] Failed to query stream statuses:',
        streamQueryError,
      );
    }

    // Resolve savedMessageId from cancelGeneration if we didn't capture it
    if (userCancelled && !savedMessageId && cancelMeta?.cancelledMessageId) {
      savedMessageId = cancelMeta.cancelledMessageId;
    }

    // Handle persistent text stream cleanup.
    // When suppressErrorCleanup is set (fallback retry in progress), skip
    // marking the stream as error and clearing generation status — the
    // caller will handle cleanup. This prevents the loading indicator from
    // disappearing and error messages from flashing between retries.
    // Stream cleanup + clearGenerationStatus are independent; run in
    // parallel so the spinner clears as fast as possible on errors too.
    if (streamId && !suppressErrorCleanup) {
      const streamCleanup = (async () => {
        try {
          if (userCancelled) {
            // Complete the stream cleanly — content was already streamed
            await ctx.runMutation(
              internal.streaming.internal_mutations.completeStream,
              { streamId },
            );
          } else {
            await ctx.runMutation(
              internal.streaming.internal_mutations.errorStream,
              { streamId },
            );
          }
        } catch (streamError) {
          console.error(
            '[generateAgentResponse] Failed to finalize stream:',
            streamError,
          );
        }
      })();

      const statusCleanup = ctx
        .runMutation(
          internal.threads.internal_mutations.clearGenerationStatus,
          {
            threadId,
            streamId,
          },
        )
        .catch((clearError) => {
          console.error(
            '[generateAgentResponse] Failed to clear generation status:',
            clearError,
          );
        });

      await Promise.all([streamCleanup, statusCleanup]);
    }

    // Abort any stuck agent SDK streams. The SDK's DeltaStreamer.fail() may
    // not have been called if the action threw before the SDK could clean up.
    // abortStream is idempotent — safe even if already finished or aborted.
    for (const stream of stuckStreams) {
      try {
        await abortStream(ctx, components.agent, {
          streamId: stream.streamId,
          reason: 'error',
        });
      } catch (abortError) {
        console.error(
          `[generateAgentResponse] Failed to abort stream ${stream.streamId}:`,
          abortError,
        );
      }
    }

    // Update "Retrying…" system message to indicate retry failed
    if (retrySystemMessageId) {
      try {
        await ctx.runMutation(components.agent.messages.updateMessage, {
          messageId: retrySystemMessageId,
          patch: {
            message: {
              role: 'system',
              content: '[RESPONSE_INTERRUPTED] Retry failed',
            },
          },
        });
      } catch (retryMsgError) {
        console.error(
          '[generateAgentResponse] Failed to update retry system message:',
          retryMsgError,
        );
      }
    }

    // Save failed message — skip if user cancelled (cancelGeneration handles it)
    // or if suppressErrorCleanup is set (fallback retry will handle it).
    let failedMessageId: string | undefined;
    if (!userCancelled && !suppressErrorCleanup) {
      try {
        const msgs = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { cursor: null, numItems: 5 },
          excludeToolMessages: true,
        });
        const newestAssistant = msgs.page.find(
          (m: MessageDoc) => m.message?.role === 'assistant',
        );
        const failedContent =
          'I was unable to complete your request. Please try again.';

        if (newestAssistant?.status === 'failed') {
          // Already marked as failed (e.g. by SDK's call.fail())
          failedMessageId = newestAssistant._id;
        } else if (newestAssistant?.status === 'pending') {
          // Zombie pending message — the SDK created it but finalizeMessage
          // crashed (e.g. provider 403 inside stream processing). Update it
          // in-place to "failed" so the user sees the error.
          await ctx.runMutation(components.agent.messages.updateMessage, {
            messageId: newestAssistant._id,
            patch: {
              status: 'failed',
              error: errorMessage || 'Unknown error',
              message: {
                role: 'assistant' as const,
                content: failedContent,
              },
            },
          });
          failedMessageId = newestAssistant._id;
        } else {
          // No existing assistant message to update — create a new one
          const { messageId: failedMsgId } = await saveMessage(
            ctx,
            components.agent,
            {
              threadId,
              message: {
                role: 'assistant',
                content: failedContent,
              },
              metadata: {
                status: 'failed',
                error: errorMessage || 'Unknown error',
              },
            },
          );
          failedMessageId = failedMsgId;
        }
      } catch (saveError) {
        console.error(
          '[generateAgentResponse] Failed to save failed message:',
          saveError,
        );
      }
    }

    // Record partial metadata for debugging even on failure
    const metadataMessageId = savedMessageId ?? failedMessageId;
    if (metadataMessageId) {
      try {
        const durationMs = Date.now() - startTime;
        const { toolCalls, toolsUsage, citations } = extractToolCallsFromSteps(
          result.steps ?? [],
        );
        const contextWindowParts: string[] = [];
        if (agentInstructions) {
          contextWindowParts.push(
            wrapInDetails('📋 System Prompt', agentInstructions),
          );
        }
        if (toolsSummary) {
          contextWindowParts.push(wrapInDetails('🔧 Tools', toolsSummary));
        }
        if (structuredThreadContext) {
          contextWindowParts.push(structuredThreadContext.threadContext);
        }

        await onAgentComplete(ctx, {
          threadId,
          agentType,
          result: {
            threadId,
            messageId: metadataMessageId,
            text: '',
            model: result.response?.modelId ?? model,
            provider,
            usage: result.usage,
            durationMs,
            timeToFirstTokenMs: firstTokenTime
              ? firstTokenTime - startTime
              : undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            toolsUsage: toolsUsage.length > 0 ? toolsUsage : undefined,
            citations: citations.length > 0 ? citations : undefined,
            contextWindow:
              contextWindowParts.length > 0
                ? contextWindowParts.join('\n\n')
                : undefined,
            contextStats: structuredThreadContext?.stats,
            error: errorMessage || 'Unknown error',
          },
          organizationId,
          userId,
          teamIds,
          agentSlug,
        });
      } catch (metadataError) {
        console.error(
          '[generateAgentResponse] Failed to save error metadata:',
          metadataError,
        );
      }
    }

    // If user cancelled, return cleanly instead of re-throwing — cancelGeneration
    // already handled the message and stream state.
    if (userCancelled) {
      return {
        threadId,
        text: result.text || '',
        savedMessageId,
        durationMs: Date.now() - startTime,
        finishReason: 'cancelled',
        usage: result.usage,
        model: result.response?.modelId ?? model,
        provider,
      };
    }

    throw error;
  }
}

/**
 * Safely stringify a value with truncation.
 * Returns `[unserializable]` if JSON.stringify throws.
 */
function safeStringify(value: unknown, maxLen = 10240): string {
  if (value === undefined || value === null) return '';
  try {
    const json = JSON.stringify(value);
    if (json.length > maxLen) {
      return json.slice(0, maxLen) + '[truncated]';
    }
    return json;
  } catch (serializeError) {
    console.error('[safeStringify] Serialization failed:', serializeError);
    return '[unserializable]';
  }
}

const DUPLICATE_TOOL_RESULT_FIELDS = new Set([
  'output',
  'usage',
  'model',
  'provider',
  'citations',
]);

function stripDuplicateToolResultFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!DUPLICATE_TOOL_RESULT_FIELDS.has(key)) result[key] = val;
  }
  return result;
}

/**
 * Extract tool calls and tool usage from AI SDK steps.
 * Tracks ALL tool calls (not just delegation tools).
 */
function extractToolCallsFromSteps(steps: unknown[]): {
  toolCalls: Array<{ toolName: string; status: string }>;
  toolsUsage: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
    costEstimateCents?: number;
  }>;
  citations: Array<{
    index: number;
    type: 'rag' | 'web';
    source: string;
    fileId?: string;
    url?: string;
    page?: number;
    relevance?: number;
  }>;
} {
  type StepWithTools = {
    toolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      // AI SDK uses 'input'; @convex-dev/agent normalizes to 'args'
      input?: unknown;
      args?: unknown;
    }>;
    toolResults?: Array<{
      toolCallId: string;
      toolName: string;
      result?: unknown;
      output?: unknown;
    }>;
  };

  const toolCalls: Array<{ toolName: string; status: string }> = [];
  const toolsUsage: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
    costEstimateCents?: number;
  }> = [];
  const allCitations: Array<{
    index: number;
    type: 'rag' | 'web';
    source: string;
    fileId?: string;
    url?: string;
    page?: number;
    relevance?: number;
  }> = [];
  // Track running offset so citations from different tool calls get unique indices.
  // Without this, both rag_search and web tools start at index 1, and the frontend
  // Map<number, CitationInfo> keyed by index would let later tools overwrite earlier ones.
  let citationIndexOffset = 0;

  for (const rawStep of steps) {
    if (!isRecord(rawStep)) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- AI SDK step arrays are typed as unknown[]; structure is verified by isRecord guard above
    const stepToolCalls = (
      Array.isArray(rawStep.toolCalls) ? rawStep.toolCalls : []
    ) as StepWithTools['toolCalls'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as stepToolCalls above
    const stepToolResults = (
      Array.isArray(rawStep.toolResults) ? rawStep.toolResults : []
    ) as StepWithTools['toolResults'];

    // Extract tool call statuses and usage for ALL tools
    for (const toolCall of stepToolCalls ?? []) {
      const matchingResult = stepToolResults?.find(
        (r) => r.toolCallId === toolCall.toolCallId,
      );
      const resultRecord = isRecord(matchingResult?.result)
        ? matchingResult.result
        : undefined;
      const outputRecord = isRecord(matchingResult?.output)
        ? matchingResult.output
        : undefined;
      const directSuccess =
        typeof resultRecord?.success === 'boolean'
          ? resultRecord.success
          : undefined;
      const outputSuccess =
        typeof outputRecord?.success === 'boolean'
          ? outputRecord.success
          : undefined;
      const isSuccess = directSuccess ?? outputSuccess ?? true;
      toolCalls.push({
        toolName: toolCall.toolName,
        status: isSuccess ? 'completed' : 'failed',
      });

      // Extract structured citations from raw tool result before safeStringify truncation.
      // The result may be the direct return value, or wrapped as {value: {...}} by @convex-dev/agent.
      const rawOutput = matchingResult?.output ?? matchingResult?.result;
      const citationSource =
        isRecord(rawOutput) && Array.isArray(rawOutput.citations)
          ? rawOutput.citations
          : isRecord(rawOutput) &&
              isRecord(rawOutput.value) &&
              Array.isArray(rawOutput.value.citations)
            ? rawOutput.value.citations
            : undefined;
      if (Array.isArray(citationSource)) {
        let maxIndexThisToolCall = 0;
        for (const c of citationSource) {
          if (
            isRecord(c) &&
            typeof c.index === 'number' &&
            typeof c.type === 'string' &&
            (c.type === 'rag' || c.type === 'web')
          ) {
            const citationType: 'rag' | 'web' = c.type;
            const adjustedIndex =
              (typeof c.index === 'number' ? c.index : 0) + citationIndexOffset;
            // Convex validators reject explicit `undefined` — omit undefined fields
            const entry: (typeof allCitations)[number] = {
              index: adjustedIndex,
              type: citationType,
              source: typeof c.source === 'string' ? c.source : 'Unknown',
            };
            if (typeof c.fileId === 'string') entry.fileId = c.fileId;
            if (typeof c.url === 'string') entry.url = c.url;
            if (typeof c.page === 'number') entry.page = c.page;
            if (typeof c.relevance === 'number') entry.relevance = c.relevance;
            allCitations.push(entry);
            if (adjustedIndex > maxIndexThisToolCall) {
              maxIndexThisToolCall = adjustedIndex;
            }
          }
        }
        // Advance offset so the next tool call's citations don't collide
        if (maxIndexThisToolCall > 0) {
          citationIndexOffset = maxIndexThisToolCall;
        }
      }

      const inputStr = safeStringify(toolCall.input ?? toolCall.args);
      // Keep the full tool output so the message-info dialog can show what a
      // tool actually returned. Strip only fields that duplicate info captured
      // elsewhere in the metadata (tokens/model/provider live on `usageEntry`,
      // citations on `allCitations`) and `output` which is a self-reference.
      // safeStringify truncates at 10KB so oversize payloads are capped.
      const rawForOutput = matchingResult?.output ?? matchingResult?.result;
      // Unwrap {value: {...}} wrapper if present (from @convex-dev/agent)
      const unwrapped =
        isRecord(rawForOutput) && isRecord(rawForOutput.value)
          ? rawForOutput.value
          : isRecord(rawForOutput)
            ? rawForOutput
            : undefined;
      const outputStr = safeStringify(
        unwrapped ? stripDuplicateToolResultFields(unwrapped) : rawForOutput,
      );

      const usageEntry: (typeof toolsUsage)[number] = {
        toolName: toolCall.toolName,
        input: inputStr,
        output: outputStr,
      };

      if (matchingResult) {
        type ToolResultData = {
          model?: string;
          provider?: string;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
            durationSeconds?: number;
          };
        };

        const extractToolResultData = (
          val: unknown,
        ): ToolResultData | undefined => {
          if (!isRecord(val)) return undefined;
          return {
            model: typeof val.model === 'string' ? val.model : undefined,
            provider:
              typeof val.provider === 'string' ? val.provider : undefined,
            usage: isRecord(val.usage)
              ? {
                  inputTokens:
                    typeof val.usage.inputTokens === 'number'
                      ? val.usage.inputTokens
                      : undefined,
                  outputTokens:
                    typeof val.usage.outputTokens === 'number'
                      ? val.usage.outputTokens
                      : undefined,
                  totalTokens:
                    typeof val.usage.totalTokens === 'number'
                      ? val.usage.totalTokens
                      : undefined,
                  durationSeconds:
                    typeof val.usage.durationSeconds === 'number'
                      ? val.usage.durationSeconds
                      : undefined,
                }
              : undefined,
          };
        };

        const directResult = extractToolResultData(matchingResult.result);
        const outputDirect = extractToolResultData(matchingResult.output);
        const outputValueRaw = isRecord(matchingResult.output)
          ? matchingResult.output.value
          : undefined;
        const outputValue = extractToolResultData(outputValueRaw);

        const hasRelevantData = (d: ToolResultData | undefined) =>
          d?.model !== undefined || d?.usage !== undefined;
        const toolData = hasRelevantData(directResult)
          ? directResult
          : hasRelevantData(outputDirect)
            ? outputDirect
            : outputValue;
        const toolUsage = toolData?.usage;

        usageEntry.model = toolData?.model;
        usageEntry.provider = toolData?.provider;
        usageEntry.inputTokens = toolUsage?.inputTokens;
        usageEntry.outputTokens = toolUsage?.outputTokens;
        usageEntry.totalTokens = toolUsage?.totalTokens;
        usageEntry.durationMs = toolUsage?.durationSeconds
          ? Math.round(toolUsage.durationSeconds * 1000)
          : undefined;

        if (
          usageEntry.model &&
          (usageEntry.inputTokens || usageEntry.outputTokens)
        ) {
          usageEntry.costEstimateCents = estimateCostCents(
            usageEntry.model,
            usageEntry.inputTokens ?? 0,
            usageEntry.outputTokens ?? 0,
          );
        }
      }

      toolsUsage.push(usageEntry);
    }
  }

  return { toolCalls, toolsUsage, citations: allCitations };
}

/**
 * Merge usage stats from two LLM calls.
 * Used when retrying with empty text.
 */
function mergeUsage(
  usage1?: GenerateResponseResult['usage'],
  usage2?: GenerateResponseResult['usage'],
): GenerateResponseResult['usage'] {
  if (!usage1) return usage2;
  if (!usage2) return usage1;
  return {
    inputTokens: (usage1.inputTokens ?? 0) + (usage2.inputTokens ?? 0),
    outputTokens: (usage1.outputTokens ?? 0) + (usage2.outputTokens ?? 0),
    totalTokens: (usage1.totalTokens ?? 0) + (usage2.totalTokens ?? 0),
    reasoningTokens:
      (usage1.reasoningTokens ?? 0) + (usage2.reasoningTokens ?? 0),
    cachedInputTokens:
      (usage1.cachedInputTokens ?? 0) + (usage2.cachedInputTokens ?? 0),
  };
}

/**
 * Determine if a retry is needed because tools were called but no
 * substantive follow-up text was generated.
 *
 * Catches two scenarios:
 * 1. Text is completely empty (LLM stopped right after tool calls)
 * 2. Text exists but is only a preamble before tool calls (e.g., "Let me check...")
 *    with no actual response incorporating the tool results
 */
function needsToolResultRetry(
  text: string | undefined,
  steps: unknown[] | undefined,
): boolean {
  if (!steps || steps.length === 0) return false;

  // Completely empty text always needs retry if there were steps
  if (!text?.trim()) return true;

  type StepLike = { toolCalls?: Array<{ toolName: string }>; text?: string };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  const typedSteps = steps as StepLike[];
  const hasToolSteps = typedSteps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (!hasToolSteps) return false;

  const lastStep = typedSteps[typedSteps.length - 1];
  const lastStepHasToolCalls = (lastStep?.toolCalls?.length ?? 0) > 0;
  const lastStepText = lastStep?.text?.trim() ?? '';

  // Retry if:
  // - The last step itself has tool calls (response ended mid-tool-execution,
  //   LLM output like "Let me check..." is just preamble before tool calls)
  // - The last step (follow-up after tool results) has no text
  return lastStepHasToolCalls || !lastStepText;
}

/**
 * Finish reasons that indicate a completed or non-retryable state.
 * - "stop": normal LLM completion
 * - "cancelled": user explicitly cancelled the generation
 * - "timeout-recovery" / "timeout-recovery-failed": already a recovery attempt
 */
const NON_RETRYABLE_FINISH_REASONS = new Set([
  'stop',
  'cached',
  'cancelled',
  'content-filter',
  'error',
  'timeout-recovery',
  'timeout-recovery-failed',
]);

/**
 * Determine whether the generation result should be retried based on
 * `finishReason`. Only `"stop"` (and other non-retryable custom reasons)
 * counts as a successful completion. All other finish reasons — `"length"`,
 * `"tool-calls"`, `"content-filter"`, `"unknown"`, `undefined`, etc. —
 * trigger a single retry without tools.
 *
 * Special case: `finishReason === "stop"` with empty text after tool calls
 * (known DeepSeek edge case) still triggers a retry.
 */
function shouldRetryGeneration(
  finishReason: string | undefined,
  text: string | undefined,
  steps: unknown[] | undefined,
  alreadyRetried: boolean,
): { retry: boolean; reason: string } {
  if (alreadyRetried) return { retry: false, reason: 'already-retried' };

  if (finishReason && NON_RETRYABLE_FINISH_REASONS.has(finishReason)) {
    if (finishReason === 'stop' && needsToolResultRetry(text, steps)) {
      return { retry: true, reason: 'stop-with-empty-tool-result' };
    }
    return { retry: false, reason: 'non-retryable-finish-reason' };
  }

  return {
    retry: true,
    reason: `finish-reason-${finishReason ?? 'undefined'}`,
  };
}

/**
 * Extract unique tool names from AI SDK steps for fallback messages.
 */
function extractToolNamesFromSteps(steps: unknown[]): string[] {
  type StepWithToolCalls = { toolCalls?: Array<{ toolName: string }> };
  const names = new Set<string>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  for (const step of steps as StepWithToolCalls[]) {
    for (const tc of step.toolCalls ?? []) {
      names.add(tc.toolName);
    }
  }
  return [...names];
}

/**
 * Walks the SDK's `savedMessages` array (one entry per saved chat
 * message during this generation) and returns the (toolCallId →
 * messageId) pairs for the named tool. Used by the post-generation hook
 * to backfill `userMemories.sourceMessageId` once the assistant turn
 * has been persisted (the convex-agent SDK does not surface the
 * assistant message id at tool-execute time).
 */
export function extractToolCallMessageMapping(
  savedMessages: unknown,
  toolName: string,
): Array<{ toolCallId: string; messageId: string }> {
  if (!Array.isArray(savedMessages)) return [];
  const mappings: Array<{ toolCallId: string; messageId: string }> = [];
  for (const entry of savedMessages) {
    if (!isRecord(entry)) continue;
    const messageId = typeof entry._id === 'string' ? entry._id : undefined;
    if (!messageId) continue;
    const message = entry.message;
    if (!isRecord(message)) continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part.type !== 'tool-call') continue;
      if (part.toolName !== toolName) continue;
      const toolCallId =
        typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
      if (!toolCallId) continue;
      mappings.push({ toolCallId, messageId });
    }
  }
  return mappings;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export { shouldRetryGeneration, needsToolResultRetry };
