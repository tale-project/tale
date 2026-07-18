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
import { type ModelMessage, stepCountIs } from 'ai';

import {
  classifyChatErrorCode,
  encodeChatError,
} from '../../../lib/shared/chat-errors';
import {
  formatGenerationIncompleteBody,
  formatStepLimitBody,
  SYSTEM_MSG_TAG,
} from '../../../lib/shared/constants/system-message-tags';
import { tuningInstructionSuffix } from '../../../lib/shared/response-tuning';
import { isRecord, getString } from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { queryRagContext } from '../../agent_tools/rag/query_rag_context';
import { queryWebContext } from '../../agent_tools/web/helpers/query_web_context';
import {
  finalizeSanitize,
  loadGuardrailsSnapshot,
  type GuardrailsSnapshot,
} from '../../governance/sanitize';
import {
  createGuardrailsTransform,
  makeInitialState,
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
  loadStructuredHistory,
  AGENT_CONTEXT_CONFIGS,
  RECOVERY_TIMEOUT_MS,
  estimateTokens,
  type StructuredContextResult,
} from '../context_management';
import {
  resolveContextBudget,
  resolveEffectiveContextWindow,
  shouldCompact,
} from '../context_management/compaction/budget';
import { wrapInDetails } from '../context_management/message_formatter';
import { createDebugLog } from '../debug_log';
import { orgSlugFromId } from '../helpers/org_slug';
import { summarizeForLog } from '../log_redact';
import {
  computeThinkingDurationMs,
  resolveTurnStartMs,
  startAbortWatcher,
  type AbortWatcher,
} from './abort_watcher';
import {
  buildProjectInstructions,
  type ProjectInstructionsBlock,
} from './build_project_instructions';
import {
  buildSystemPrompt,
  instructionsAreCacheable,
} from './build_system_prompt';
import {
  buildUserPersonalization,
  type UserPersonalization,
} from './build_user_personalization';
import {
  extractToolCallMessageMapping,
  extractToolCallsFromSteps,
  extractToolNamesFromSteps,
} from './extract_tool_calls';
import {
  applyGuardrailsBlockTombstone,
  buildBlockedReturn,
  convexErrorToBlockedReason,
  OUTPUT_BLOCKED_SENTINEL,
} from './guardrails_block';
import { analyzeResponseQuality } from './quality/analyze';
import { thresholdsFor } from './quality/thresholds';
import { buildReasoningOptions } from './reasoning/build_reasoning_options';
import { reasoningScopeKey } from './reasoning/scope';
import { resolveTemplateVariables } from './resolve_template_variables';
import {
  endedOnHumanInputGate,
  mergeUsage,
  needsToolResultRetry,
  shouldRetryGeneration,
} from './retry_policy';
import { hasValidToolCall } from './stop_conditions';
import {
  finalizePersistentStream,
  linkApprovalsToLatestAssistantMessage,
} from './stream_finalizers';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from './structured_response_instructions';
import type {
  BeforeContextResult,
  GenerateResponseArgs,
  GenerateResponseConfig,
  GenerateResponseResult,
} from './types';
import { AgentTimeoutError, withTimeout } from './with_timeout';

/**
 * Similarity threshold for the auto-RAG query when the turn carries
 * `@`-mentioned (pinned) documents. Matches the `rag_search` tool default —
 * the standard 0.51 returns nothing for indirect phrasings like
 * "summarize @Doc", and the pinned scope already bounds the result set.
 */
const PINNED_KB_SIMILARITY_THRESHOLD = 0.3;

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
    agentProjectIds,
    structuredResponsesEnabled,
    instructions,
    toolsSummary,
    personalizationMode,
    providerOptions,
    convexToolNames,
    modelMaxOutputTokens,
    modelContextWindow,
    reasoningCapability,
    responseStyle,
    routeSeed,
    replyLocaleHint,
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
    autoRouteReason,
    teamIds,
    providerCost,
    parentThreadId,
    agentOptions,
    streamId,
    promptMessageId,
    maxSteps: _maxSteps,
    generationParams,
    suppressErrorCleanup,
    prewarm,
    pinnedFileIds,
  } = args;

  // Hard-stop the agent loop the moment `request_human_input` is called. That
  // tool only surfaces an approval card and tells the model to stop and wait —
  // but "stop" was a prompt-only contract the model could (and did) ignore,
  // most visibly the researcher barrelling past its plan-confirmation card
  // straight into web searches. `hasValidToolCall` turns the gate into a real
  // stop — but only for calls that passed input validation: an invalid call
  // never created a card, so the loop must keep going and let the model fix
  // its arguments. Scoped to agents that actually expose the tool so no other
  // agent's loop behaviour changes. Setting `stopWhen` makes the SDK ignore
  // the config's `maxSteps`, so the step cap is re-applied here via
  // `stepCountIs` (mirroring the default in create_agent_config.ts).
  const humanInputStopWhen = convexToolNames?.includes('request_human_input')
    ? [
        stepCountIs(args.maxSteps ?? 40),
        hasValidToolCall('request_human_input'),
      ]
    : undefined;

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
  let structuredThreadContext: StructuredContextResult | undefined;
  let agentInstructions: string | undefined;
  let retrySystemMessageId: string | undefined;
  let firstTokenTime: number | null = null;
  // First reasoning ("thinking") delta — what the user is actually waiting
  // for on a reasoning model, and which streams BEFORE the first text-delta.
  // Tracked separately from firstTokenTime (which is first answer content).
  // LIMITATION: captured only via the streaming `onChunk` below. The
  // non-streaming `agent.generateText` path (sub-agents) and the
  // `continueAgent.generateText` retry (DeepSeek empty-with-tools) have no
  // onChunk, so on those turns this stays null and the reasoning/send metrics
  // are undercounted — acceptable, as the metric targets the streaming chat path.
  let firstReasoningTime: number | null = null;
  // chatWithAgent entry when threaded through the action chain; otherwise this
  // action's start, so the metric degrades gracefully for older in-flight jobs
  // and non-chat callers that don't supply it.
  const sendStartMs = args.requestStartMs ?? startTime;
  // Derive the two reasoning-aware timings from the latest first-token marks.
  // Called at each onAgentComplete site (success / error / cancel).
  // Wall-clock at the moment we hand off to the LLM (just before streamText).
  // Lets the PERF trace split "our pre-stream setup" from "model TTFR".
  let preStreamAtMs: number | null = null;
  const computeReasoningTimings = () => ({
    timeToFirstReasoningMs:
      firstReasoningTime != null ? firstReasoningTime - startTime : undefined,
    // First user-visible token of EITHER kind (reasoning preferred), measured
    // from send so it captures the full pre-stream backend overhead.
    timeFromSendMs:
      firstReasoningTime != null
        ? firstReasoningTime - sendStartMs
        : firstTokenTime != null
          ? firstTokenTime - sendStartMs
          : undefined,
  });
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
  // The guardrails snapshot + orgSlug fetch is hoisted into the context
  // Promise.all below (parallel with RAG/history) so it overlaps the context
  // build instead of being a serial step before `streamText`. These only feed
  // the OUTPUT transform (and end-of-stream sanitize), which don't run until
  // after the first token. Skipped for prewarm (no output to sanitize).
  let result: {
    text?: string;
    steps?: unknown[];
    usage?: GenerateResponseResult['usage'];
    finishReason?: string;
    response?: { modelId?: string };
    reasoning?: string;
  } = {};

  // Assemble the collapsible <details> context-window blocks for metadata:
  // system prompt, tools, then the thread context (when available). Shared by
  // the cancel / success / error metadata paths. Declared outside the try so
  // the catch block's error-metadata path can reuse it.
  const buildContextWindowParts = (
    threadContext: string | undefined,
  ): string[] => {
    const parts: string[] = [];
    if (agentInstructions) {
      parts.push(wrapInDetails('📋 System Prompt', agentInstructions));
    }
    if (toolsSummary) {
      parts.push(wrapInDetails('🔧 Tools', toolsSummary));
    }
    if (threadContext !== undefined) parts.push(threadContext);
    return parts;
  };

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
        // Check cancelledAt on threadMetadata. Anchor on the TURN's start
        // (generationStartTime), not this action's local startTime: a cancel
        // between the turn start and this action starting is BEFORE startTime
        // and would otherwise be missed → a phantom reply persists (#74).
        const meta = await ctx.runQuery(
          internal.threads.internal_queries.getThreadMetadata,
          { threadId },
        );
        const turnStartMs = meta?.generationStartTime ?? startTime;
        if (meta?.cancelledAt && meta.cancelledAt >= turnStartMs) {
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
          let cancelContextStats: StructuredContextResult['stats'] | undefined;

          if (structuredThreadContext) {
            cancelContextWindow = buildContextWindowParts(
              structuredThreadContext.threadContext,
            ).join('\n\n');

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
              reasoning: result.reasoning,
              durationMs,
              timeToFirstTokenMs: firstTokenTime
                ? firstTokenTime - startTime
                : undefined,
              ...computeReasoningTimings(),
              contextWindow: cancelContextWindow,
              contextStats: cancelContextStats,
            },
            organizationId,
            userId,
            teamIds,
            agentSlug,
            autoRouteReason,
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

    // Guardrails-blocked turn finalizer. A content-policy block still consumed
    // provider tokens, so it must run onAgentComplete (usage ledger + AI audit
    // log + timing metadata) exactly like the success/cancel paths — the block
    // sites previously returned via buildBlockedReturn alone and silently
    // dropped all three. saveMessageMetadata merges (`?? existing`), so the
    // blocked-reason already written by applyGuardrailsBlockTombstone is kept.
    const blockedReturn = async (): Promise<GenerateResponseResult> => {
      abortWatcher?.stop();
      if (savedMessageId) {
        const durationMs = Date.now() - startTime;
        const actualModel = result.response?.modelId ?? model;
        try {
          await onAgentComplete(ctx, {
            threadId,
            agentType,
            result: {
              threadId,
              messageId: savedMessageId,
              text: OUTPUT_BLOCKED_SENTINEL,
              model: actualModel,
              provider,
              usage: result.usage,
              reasoning: result.reasoning,
              durationMs,
              timeToFirstTokenMs: firstTokenTime
                ? firstTokenTime - startTime
                : undefined,
              ...computeReasoningTimings(),
            },
            organizationId,
            userId,
            teamIds,
            agentSlug,
            providerCost,
          });
        } catch (metaError) {
          console.error(
            '[generateAgentResponse] blocked-turn onAgentComplete failed:',
            metaError,
          );
        }
      }
      return buildBlockedReturn(
        threadId,
        savedMessageId,
        result.usage,
        result.finishReason,
        startTime,
      );
    };

    // Determine retrieval modes
    const knowledgeMode = configKnowledgeMode ?? 'off';
    const webSearchMode = configWebSearchMode ?? 'off';
    // `@`-mentioned KB documents force knowledge-context injection regardless
    // of the agent's knowledgeMode — an explicit user pin is stronger intent
    // than the agent's default retrieval config.
    const hasPinnedKbRefs =
      !prewarm && pinnedFileIds !== undefined && pinnedFileIds.length > 0;
    // Prewarm skips volatile RAG/web retrieval: those land AFTER the cache
    // breakpoint, so omitting them keeps the cached prefix identical to the
    // real first turn while making the priming call cheap and fast. Thread
    // history is also volatile (post-breakpoint) but isn't gated here — prewarm
    // primes a fresh thread, so it's empty in practice either way.
    const needsKnowledgeContext =
      hasPinnedKbRefs ||
      (!prewarm && (knowledgeMode === 'context' || knowledgeMode === 'both'));
    const needsWebContext =
      !prewarm && (webSearchMode === 'context' || webSearchMode === 'both');

    // Resolve the thread's project once (single point read, ~free): files
    // uploaded to a project must be retrievable in that project's chat, so
    // the thread's project is unioned into the agent's (config-provided)
    // project scope for BOTH context injection below and the rag_search tool
    // (contextWithOrg). The project-instructions block reuses the same id.
    // Degrades to "no project scope" on failure rather than aborting.
    //
    // The stored thread↔project binding is NOT proof of access at send time
    // (membership may have been revoked since the thread was created), so the
    // sender's CURRENT project access is re-verified before the scope widens.
    // Turns without a user identity get no thread-project scope — only the
    // agent's own config can grant one there.
    let threadProjectId: Id<'projects'> | null = null;
    try {
      const storedProjectId = await ctx.runQuery(
        internal.projects.internal_queries.getProjectIdForThread,
        { threadId },
      );
      if (storedProjectId && userId && organizationId) {
        const projectAccess = await ctx.runQuery(
          internal.projects.internal_queries.assertProjectAccessForChat,
          { projectId: storedProjectId, organizationId, userId },
        );
        if (projectAccess.allowed) {
          threadProjectId = storedProjectId;
        } else {
          console.warn(
            '[generateAgentResponse] sender lacks project access; skipping project scope',
            { threadId, reason: projectAccess.reason },
          );
        }
      }
    } catch (err) {
      console.warn(
        '[generateAgentResponse] thread project resolve failed; skipping project scope',
        err instanceof Error ? err.message : err,
      );
    }
    const effectiveAgentProjectIds = threadProjectId
      ? [...new Set([...(agentProjectIds ?? []), String(threadProjectId)])]
      : agentProjectIds;

    // Start context injection queries (non-blocking) for context/both modes
    let knowledgeContextPromise:
      | Promise<
          | import('../../agent_tools/rag/query_rag_context').RagContextResult
          | undefined
        >
      | undefined;
    if (needsKnowledgeContext && organizationId && promptMessage) {
      // Resolve the agent's RAG scope defensively: on a very large knowledge
      // corpus this query can hit the Convex transaction read cap and throw.
      // Degrade to "no knowledge context this turn" (logged) rather than abort
      // the whole response — same guardrail as the orgSlugFromId resolve below.
      let accessibleFileIds: string[] = [];
      if (hasPinnedKbRefs && pinnedFileIds) {
        // Explicit `@`-mentions REPLACE the agent scope for this turn (focused
        // retrieval over the pinned documents only). Access was validated
        // synchronously in chatWithAgentTurn, so no scope query is needed.
        accessibleFileIds = pinnedFileIds;
      } else {
        try {
          accessibleFileIds = await ctx.runQuery(
            internal.documents.internal_queries.getAgentScopedFileIds,
            {
              organizationId,
              agentTeamId,
              agentTeamIds,
              includeTeamKnowledge,
              includeOrgKnowledge,
              knowledgeFileIds,
              agentProjectIds: effectiveAgentProjectIds,
            },
          );
        } catch (err) {
          console.warn(
            '[generateAgentResponse] getAgentScopedFileIds failed; skipping knowledge context',
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (accessibleFileIds.length === 0) {
        debugLog('No accessible RAG documents, skipping knowledge context');
      } else {
        // Resolve slug defensively: a transient lookup miss (org row
        // deleted between membership check and here, replica skew) should
        // degrade gracefully — skip knowledge context — rather than abort
        // the entire response generation. Matches the guardrails-resolve
        // pattern lower in this file.
        let orgSlug: string | undefined;
        try {
          orgSlug = await orgSlugFromId(ctx, organizationId);
        } catch (err) {
          console.warn(
            '[generateAgentResponse] orgSlugFromId failed; skipping knowledge context',
            err instanceof Error ? err.message : err,
          );
        }
        if (orgSlug) {
          knowledgeContextPromise = queryRagContext(
            ctx,
            promptMessage,
            undefined,
            // Pinned queries relax the similarity threshold (matching the
            // rag_search tool default): "summarize @Doc" phrasing scores low
            // against the doc body, and the default 0.51 returns nothing.
            hasPinnedKbRefs ? PINNED_KB_SIMILARITY_THRESHOLD : undefined,
            undefined,
            undefined,
            { fileIds: accessibleFileIds, orgSlug },
          );
          debugLog('Knowledge context query started', {
            threadId,
            pinned: hasPinnedKbRefs,
            elapsedMs: Date.now() - startTime,
          });
        }
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

    // Project instructions block — assembles the XML-wrapped block to inject
    // into the system prompt between agent instructions and user
    // personalization. Empty when the chat is not inside a project (the
    // thread's projectId was resolved once above, shared with the RAG scope).
    // Parallel with personalization for TTFT.
    const projectInstructionsPromise: Promise<ProjectInstructionsBlock> =
      (async () => {
        try {
          if (!threadProjectId) {
            return { text: '', tokens: 0, fingerprint: '' };
          }
          return await buildProjectInstructions({
            ctx,
            projectId: threadProjectId,
          });
        } catch (err) {
          console.error('[generate_response] projectInstructions failed', err);
          return { text: '', tokens: 0, fingerprint: '' };
        }
      })();

    // History budget + the paginated history load, hoisted ABOVE the context
    // Promise.all: the load depends only on the thread, the token budget, and
    // the compaction boundary (threadMetadata.contextSummary) — never on the
    // RAG / web / personalization legs — so it runs concurrently with them
    // instead of serially after (on long threads the sequential page loop was
    // pure added TTFT). The builder consumes it via `preloadedHistory`.
    const agentConfig = AGENT_CONTEXT_CONFIGS[agentType];
    const governanceMaxContext =
      config.maxContextTokens ?? args.maxContextTokens;
    // History budget scales with the model's real context window (capped), so a
    // long chat actually fills the window and auto-compaction can kick in at
    // ~90%. Never dips below the per-agent default; governance still caps it.
    // An unknown context window falls back to a sensible default inside
    // `resolveContextBudget`.
    const effectiveMaxHistoryTokens = resolveContextBudget({
      contextWindow: modelContextWindow,
      governanceMaxContext:
        governanceMaxContext != null &&
        Number.isFinite(governanceMaxContext) &&
        governanceMaxContext > 0
          ? governanceMaxContext
          : undefined,
      agentDefault: agentConfig.maxHistoryTokens,
    });
    debugLog('History budget resolved', {
      modelContextWindow,
      governanceLimit: governanceMaxContext,
      agentDefault: agentConfig.maxHistoryTokens,
      effective: effectiveMaxHistoryTokens,
    });
    // Adaptive Reasoning Governor (Layer C) state — also the source of the
    // compaction summary that bounds the history load. Shared with the context
    // Promise.all below (awaiting a promise twice is safe).
    const threadMetadataPromise = ctx
      .runQuery(internal.threads.internal_queries.getThreadMetadata, {
        threadId,
      })
      .catch((err: unknown) => {
        console.warn(
          '[reasoning] getThreadMetadata failed; using cold-start prior',
          err instanceof Error ? err.message : err,
        );
        return null;
      });
    const historyPromise = threadMetadataPromise.then((meta) =>
      loadStructuredHistory(
        ctx,
        threadId,
        effectiveMaxHistoryTokens,
        meta?.contextSummary?.coversThroughOrder,
      ),
    );
    // Observe an early rejection so it can never surface as an unhandled
    // rejection while the context Promise.all is still running; the real
    // await at context build below still throws the original error.
    void historyPromise.catch((err: unknown) =>
      console.warn(
        '[generate_response] history preload failed (surfaces at context build):',
        err instanceof Error ? err.message : err,
      ),
    );

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
    const [
      knowledgeContextResult,
      webContextResult,
      userPersonalization,
      projectInstructionsBlock,
      reasoningStateRow,
      reasoningProfile,
      guardrailsPair,
    ] = await Promise.all([
      knowledgeContextPromise ?? Promise.resolve(undefined),
      webContextPromise ?? Promise.resolve(undefined),
      userPersonalizationPromise ??
        Promise.resolve<UserPersonalization>({
          text: '',
          fingerprint: '',
          injectedMemoryIds: [],
          tokens: 0,
        }),
      projectInstructionsPromise,
      // Adaptive Reasoning Governor (Layer C): the thread's learned reasoning
      // state — the same promise the history preload above chained from, so
      // it adds no serial latency and is fetched exactly once.
      threadMetadataPromise,
      // Inherited cross-thread profile (per org + model) for warm-starting a
      // fresh thread. Also parallel, also best-effort.
      organizationId
        ? ctx
            .runQuery(internal.threads.internal_queries.getReasoningProfile, {
              organizationId,
              scopeKey: reasoningScopeKey(model, agentType),
            })
            .catch((err: unknown) => {
              console.warn(
                '[reasoning] getReasoningProfile failed; no warm start',
                err instanceof Error ? err.message : err,
              );
              return null;
            })
        : Promise.resolve(null),
      // Output guardrails snapshot + orgSlug. Independent of RAG/history, so
      // resolved here in parallel rather than serially before the LLM call.
      // Wrapped as ONE self-catching tuple so a transient load failure degrades
      // BOTH to null (stream without output guardrails) — exactly the prior
      // behavior — instead of turning a transient failure into a failed turn.
      organizationId && !prewarm
        ? Promise.all([
            loadGuardrailsSnapshot(ctx, organizationId),
            resolveOrgSlug(ctx, organizationId),
          ]).catch(
            (err: unknown): [GuardrailsSnapshot | null, string | null] => {
              console.warn(
                `[guardrails] failed to load snapshot for org ${organizationId}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              return [null, null];
            },
          )
        : Promise.resolve<[GuardrailsSnapshot | null, string | null]>([
            null,
            null,
          ]),
    ]);
    const reasoningState = reasoningStateRow?.reasoningState ?? undefined;
    // Assign the hoisted guardrails state from the parallel resolve above.
    [guardrailsSnapshot, resolvedOrgSlug] = guardrailsPair;
    // Auto-compaction rolling summary (compacted earlier turns). Injected into
    // the context and used to exclude already-summarized messages.
    const contextSummary = reasoningStateRow?.contextSummary;

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

    // Build structured context (history, RAG, web). The history itself was
    // preloaded concurrently with the Promise.all above, so `contextBuildMs`
    // now measures only the RESIDUAL wait (history slower than the other
    // legs) plus the pure string assembly.
    // Note: promptMessage is NOT included - it's passed via `prompt` parameter
    const contextBuildStart = Date.now();
    structuredThreadContext = await buildStructuredContext({
      ctx,
      threadId,
      additionalContext,
      parentThreadId,
      maxHistoryTokens: effectiveMaxHistoryTokens,
      ragContext: knowledgeContextResult?.text ?? hookData?.ragContext,
      webContext: webContextResult?.text,
      artifactsContext: undefined,
      promptMessageId,
      contextSummary,
      preloadedHistory: await historyPromise,
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
    // agentProjectIds carries the thread's project too, so the rag_search
    // tool searches project files inside their own project's chat.
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
      agentProjectIds: effectiveAgentProjectIds,
    };

    let didRetry = false;
    let retryInProgress = false;
    // Set when the retry-exhausted fallback fired: `result.text` then holds a
    // diagnostic for RETURN-value consumers (delegate ToolResponses, logs) and
    // must NOT be persisted as the assistant's own words — the user-facing
    // outcome is the tagged [GENERATION_INCOMPLETE] system message instead.
    let fallbackNoticeSaved = false;

    const promptToSend = hookPromptContent ?? promptMessage;

    // Adaptive Reasoning Governor: decide how hard the model should think this
    // turn (difficulty prior → online controller, gated and translated by the
    // model's capability) and merge the resulting knob into providerOptions.
    // Computed once and reused across the stream / generate / continue /
    // recovery calls below. Requires the resolved providerName (`provider`) to
    // namespace the overlay; without it we pass the base options through.
    const reasoningDecision = provider
      ? buildReasoningOptions({
          modelData: {
            providerName: provider,
            modelId: model,
            maxOutputTokens: modelMaxOutputTokens,
            reasoning: reasoningCapability,
          },
          baseProviderOptions: providerOptions,
          signals: {
            kind: enableStreaming ? 'chat' : 'subagent',
            promptText: promptMessage,
            hasAttachments: (args.attachments?.length ?? 0) > 0,
            hasRagContext: Boolean(
              knowledgeContextResult?.text ?? hookData?.ragContext,
            ),
            hasWebContext: Boolean(webContextResult?.text),
            toolCount: convexToolNames?.length ?? 0,
            maxSteps: args.maxSteps,
            agentType,
            historyMessageCount: structuredThreadContext?.stats.messageCount,
            // Auto-router reasoning seed (Auto mode only): blends the heuristic
            // difficulty prior toward the router's coarse read as a PRIOR — the
            // controller still refines from observed usage.
            effortSeed: routeSeed?.effort,
            creativitySeed: routeSeed?.creativity,
          },
          state: reasoningState,
          profile: reasoningProfile ?? undefined,
        })
      : undefined;
    const reasoningProviderOptions =
      reasoningDecision?.providerOptions ?? providerOptions;
    // Governed default temperature (creativity-scaled), unless the caller set
    // one explicitly or the model's active reasoning knob forbids it.
    const effectiveTemperature =
      generationParams?.temperature ?? reasoningDecision?.temperature;

    // Auto-router style/verbosity fragment, appended to the agent's
    // instructions for this turn. Set only in Auto mode; a pinned agent's tone
    // comes from its own instructions, so this is empty there.
    const tuningSuffix = tuningInstructionSuffix(responseStyle);
    const tunedInstructions = tuningSuffix
      ? instructions
        ? `${instructions}\n\n${tuningSuffix}`
        : tuningSuffix
      : instructions;

    // Is the stable prefix genuinely cacheable? Checked on the RAW instructions
    // (before template resolution) — once `{{current_time}}` & friends are
    // resolved they become opaque timestamps. When present, suppress the cache
    // breakpoint so we don't cache a prefix that changes every turn.
    const instructionsCacheable = instructionsAreCacheable(tunedInstructions);

    // Resolve template variables (e.g. {{organization.name}}, {{current_time}})
    const resolvedInstructions = tunedInstructions
      ? await resolveTemplateVariables(ctx, tunedInstructions, {
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
    // Response language follows the user (#1621). The model mirrors the
    // language they write in; only when the input is ambiguous does it fall
    // back, in priority order: UI language (chosen in the app) → browser
    // locale (navigator.language) → org "Default language (for agents)". The
    // org query runs only when neither client locale is present (e.g. a
    // server/workflow-triggered run). Resolved once and passed to all three
    // prompt assemblies below (shared scope) so a multi-step loop stays in
    // one language.
    // First non-blank client locale wins; `??` alone would let an empty
    // string short-circuit the chain past a usable next candidate.
    // Priority: explicit client locale (the user's own UI/browser language) →
    // the Auto router's per-message language hint → org default. The router
    // hint sits below the user's explicit locale (their standing preference)
    // but above the org default, and only ever feeds rule 3 of the directive.
    const clientLocale = [
      userContext?.uiLanguage,
      userContext?.language,
      replyLocaleHint,
    ]
      .map((locale) => locale?.trim())
      .find((locale) => locale);
    const fallbackLocale =
      clientLocale ??
      (organizationId
        ? await ctx.runQuery(
            internal.organizations.internal_queries
              .getOrganizationDefaultLocale,
            { organizationId },
          )
        : undefined);

    // System prompt order: agent identity → user personalization (custom
    // instructions + approved memories) → thread context → response language.
    // Personalization sits between the stable agent prefix and the volatile
    // thread tail so it doesn't bust upstream prompt caches when memories
    // don't change.
    const systemPrompt = buildSystemPrompt(
      agentInstructions,
      userPersonalization,
      structuredThreadContext.threadContext,
      projectInstructionsBlock,
      fallbackLocale,
      instructionsCacheable,
      new Date().toISOString(),
    );

    // Cache pre-warm: we now have the exact tools (via `agent`) + stable system
    // prefix the real first turn will use. Issue one throwaway 1-token
    // generation to prime the provider's prompt cache, then return — no
    // persistence, no streaming, no outcome recording. Best-effort: a failed
    // prime must never surface to the user.
    if (prewarm) {
      const prewarmResult = await agent
        .generateText(
          contextWithOrg,
          { threadId, userId },
          {
            system: systemPrompt,
            prompt: '.',
            // Cap the throwaway answer to the minimum; the priming cost is the
            // cache WRITE (input prefix), not the output.
            maxOutputTokens: 1,
            abortSignal: abortController.signal,
            // Use the BASE provider options, NOT the reasoning overlay: a
            // budget-knob (Anthropic-style) model would otherwise carry
            // `thinking.budget_tokens >= 1024`, which the provider rejects when
            // `max_tokens` is 1 (it requires `budget_tokens < max_tokens`) —
            // failing the prime for the very models prompt caching targets.
            // Reasoning knobs don't affect the cached prefix, so dropping them
            // here is safe.
            ...(providerOptions ? { providerOptions } : {}),
          },
          { storageOptions: { saveMessages: 'none' } },
        )
        .catch((err: unknown) => {
          console.warn(
            '[prewarm] priming call failed:',
            err instanceof Error ? err.message : err,
          );
          return undefined;
        });
      debugLog('PREWARM_DONE', {
        threadId,
        model,
        cachedInputTokens: prewarmResult?.usage?.cachedInputTokens,
        inputTokens: prewarmResult?.usage?.inputTokens,
        elapsedMs: Date.now() - startTime,
      });
      // Meter the priming spend on the usage ledger (cache WRITE = input tokens)
      // so prewarm is NOT free, untracked, ungoverned billed spend. Skip message
      // metadata (no saved message exists for a prewarm). Best-effort.
      if (prewarmResult?.usage && (prewarmResult.usage.inputTokens ?? 0) > 0) {
        await onAgentComplete(ctx, {
          threadId,
          agentType,
          result: {
            threadId,
            text: '',
            // The shared `result` accumulator is still empty here (we return
            // before generation populates it), so use the configured model id
            // directly — that's the model the prime actually billed against.
            model,
            provider,
            usage: prewarmResult.usage,
            durationMs: Date.now() - startTime,
          },
          organizationId,
          userId,
          teamIds,
          agentSlug,
          providerCost,
          options: { skipMetadata: true },
        }).catch((meterErr: unknown) =>
          console.warn(
            '[prewarm] usage metering failed:',
            meterErr instanceof Error ? meterErr.message : meterErr,
          ),
        );
      }
      return {
        threadId,
        text: '',
        finishReason: 'prewarm',
        durationMs: Date.now() - startTime,
        usage: prewarmResult?.usage,
      };
    }

    // Record the injection (one row per turn, with the IDs that were
    // folded into systemPrompt) so the data subject can later trace which
    // memories shaped a given response. Fire-and-forget — never blocks
    // the LLM call.
    if (
      userPersonalization.injectedMemoryIds.length > 0 &&
      organizationId &&
      userId
    ) {
      // Genuinely fire-and-forget (the comment above was previously belied by
      // an `await`): enqueueing the audit is a DB write whose latency sat
      // directly between system-prompt assembly and the streamText call. The
      // audit is non-critical, so let it run after dispatch.
      void ctx.scheduler
        .runAfter(
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
        )
        .catch((err: unknown) =>
          console.warn(
            '[generate_response] memory-audit schedule failed:',
            err instanceof Error ? err.message : err,
          ),
        );
    }

    debugLog('PRE_LLM_CALL', {
      threadId,
      model,
      enableStreaming,
      promptMessageId,
      reasoningTier: reasoningDecision?.tier,
      reasoningApplied: reasoningDecision?.applied ?? false,
      reasoningBudgetTokens: reasoningDecision?.budgetTokens,
      system: summarizeForLog(systemPrompt),
      prompt: summarizeForLog(promptToSend),
      effectiveTimeoutMs,
      actionDeadline: new Date(actionDeadline).toISOString(),
      elapsedMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    // Guardrails snapshot + orgSlug are resolved in the context Promise.all
    // above (parallel with RAG/history), preserving the degrade-to-null
    // semantics — used by the streaming transform (if enabled) and by
    // `finalizeSanitize` on the full text at the end. orgSlug lets moderation
    // locate the per-org SOPS secrets file. Already assigned here.

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

        preStreamAtMs = Date.now();
        // PERF (diagnostic, env-gated via debugLog): consolidated pre-stream
        // attribution. `totalPreStreamMs` is the whole send → just-before-
        // streamText window; `genPreStreamMs` is this action's own setup
        // (context Promise.all, buildSkillContext, model resolve, system prompt).
        // Enable with DEBUG_<AGENTTYPE>_AGENT=true or DEBUG_MODE=true.
        debugLog(
          'PRE_STREAM_SUMMARY',
          JSON.stringify({
            threadId,
            model,
            totalPreStreamMs: preStreamAtMs - sendStartMs,
            genPreStreamMs: preStreamAtMs - startTime,
          }),
        );
        const streamResult = await agent.streamText(
          contextWithOrg,
          { threadId, userId },
          {
            promptMessageId,
            system: systemPrompt,
            prompt: promptToSend,
            abortSignal: abortController.signal,
            ...(humanInputStopWhen ? { stopWhen: humanInputStopWhen } : {}),
            ...(outputTransform !== null && {
              experimental_transform: outputTransform,
            }),
            ...(effectiveTemperature != null && {
              temperature: effectiveTemperature,
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
            ...(reasoningProviderOptions
              ? { providerOptions: reasoningProviderOptions }
              : {}),
            onChunk: ({ chunk }: { chunk: { type: string } }) => {
              if (
                firstReasoningTime === null &&
                chunk.type === 'reasoning-delta'
              ) {
                firstReasoningTime = Date.now();
              }
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
            saveStreamDeltas: { throttleMs: 250, chunking: /[\p{P}\s]/u },
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
          streamReasoning,
        ] = await withTimeout(
          Promise.all([
            streamResult.text,
            streamResult.steps,
            streamResult.usage,
            streamResult.finishReason,
            streamResult.response,
            // Reasoning ("thinking") text the model emitted before its answer.
            // Resolves to undefined for non-reasoning models. Awaited inside
            // the same timeout so a stalled provider can't hang the turn.
            streamResult.reasoningText,
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
          reasoning: streamReasoning,
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
          // text is now expected. blockedReturn stops the abort watcher and
          // persists usage/audit/metrics (the block still billed tokens).
          return blockedReturn();
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
              // Sibling parity with the mid-stream guardrails-block path —
              // blockedReturn stops the watcher and persists usage/audit/metrics.
              return blockedReturn();
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
        // Non-streaming mode (sub-agents): same context as contextWithOrg,
        // plus parentThreadId when this is a delegated sub-thread.
        const subAgentContext = parentThreadId
          ? { ...contextWithOrg, parentThreadId }
          : contextWithOrg;

        const generateResult = await withTimeout(
          agent.generateText(
            subAgentContext,
            { threadId, userId },
            {
              system: systemPrompt,
              prompt: promptToSend,
              abortSignal: abortController.signal,
              ...(humanInputStopWhen ? { stopWhen: humanInputStopWhen } : {}),
              ...(promptMessageId ? { promptMessageId } : {}),
              ...(effectiveTemperature != null && {
                temperature: effectiveTemperature,
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
              ...(reasoningProviderOptions
                ? { providerOptions: reasoningProviderOptions }
                : {}),
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
          reasoning: generateResult.reasoningText,
        };

        // Post-generation abort check
        const cancelCheck = await checkCancelled();
        if (cancelCheck) {
          return cancelledReturn(cancelCheck.cancelledMessageId);
        }
      }

      // Unified continue loop: if finishReason is not "stop" (or other
      // non-retryable), rebuild context and keep generating. A step-cap stop
      // (finishReason 'tool-calls' — the loop ran out of `maxSteps` mid-work)
      // is an EXPECTED capacity stop on tool-heavy turns and continues
      // neutrally for up to MAX_STEP_CAP_CONTINUES rounds; provider anomalies
      // ('length', 'unknown', DeepSeek stop-with-empty-text) retry ONCE with
      // the [RESPONSE_INTERRUPTED] marker, as before. An unlabelled finish
      // ('other'/'unknown'/undefined) with substantive final text is accepted
      // as complete — no retry (see UNLABELLED_FINISH_REASONS).
      let stepCapRounds = 0;
      for (;;) {
        const continueCheck = shouldRetryGeneration(
          result.finishReason,
          result.text,
          result.steps,
          { anomalyRetried: didRetry, stepCapRounds },
        );
        if (!continueCheck.retry) break;
        const isStepCapContinue = continueCheck.kind === 'step-cap';
        const continueRemainingMs = actionDeadline - Date.now();
        if (continueRemainingMs < 30_000) {
          debugLog('Skipping continue, insufficient time remaining', {
            remainingMs: continueRemainingMs,
          });
          break;
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

          // Artifacts module removed (see context-build above) — no artifacts
          // block to build on the continuation pass either.
          const continueContext = await buildStructuredContext({
            ctx,
            threadId,
            additionalContext,
            parentThreadId,
            maxHistoryTokens: effectiveMaxHistoryTokens,
            ragContext: hookData?.ragContext,
            artifactsContext: undefined,
            promptMessageId,
            contextSummary,
          });

          const continueAgent = createAgent(agentOptions);

          const continueSystemPrompt = buildSystemPrompt(
            agentInstructions,
            userPersonalization,
            continueContext.threadContext,
            projectInstructionsBlock,
            fallbackLocale,
            instructionsCacheable,
            new Date().toISOString(),
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

          // Build the appropriate context object for the continue call.
          // Non-streaming mirrors the sub-agent context (parentThreadId when
          // this is a delegated sub-thread); streaming reuses contextWithOrg.
          const continueCtx = enableStreaming
            ? contextWithOrg
            : parentThreadId
              ? { ...contextWithOrg, parentThreadId }
              : contextWithOrg;

          // Check for cancellation before starting continue (catches cancels during context building)
          {
            const cancelCheck = await checkCancelled();
            if (cancelCheck) {
              return cancelledReturn(cancelCheck.cancelledMessageId);
            }
          }

          // Record the continuation in thread history: a neutral step-limit
          // notice for a capacity stop, the interrupted marker for an anomaly.
          const retryMsg = await saveMessage(ctx, components.agent, {
            threadId,
            message: {
              role: 'system',
              content: isStepCapContinue
                ? `${SYSTEM_MSG_TAG.STEP_LIMIT_CONTINUED} ${formatStepLimitBody({ round: stepCapRounds + 1 })}`.trim()
                : '[RESPONSE_INTERRUPTED] Retrying…',
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
                  ...(reasoningProviderOptions
                    ? { providerOptions: reasoningProviderOptions }
                    : {}),
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

            if (isStepCapContinue) {
              stepCapRounds += 1;
            } else {
              didRetry = true;
            }
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
              reasoning: continueResult.reasoningText ?? result.reasoning,
            };

            // Update the "Retrying…" system message now that the retry
            // succeeded. A step-cap continuation keeps its neutral
            // [STEP_LIMIT_CONTINUED] notice as saved — nothing to patch.
            if (retrySystemMessageId) {
              if (!isStepCapContinue) {
                try {
                  await ctx.runMutation(
                    components.agent.messages.updateMessage,
                    {
                      messageId: retrySystemMessageId,
                      patch: {
                        message: {
                          role: 'system',
                          content: '[RESPONSE_INTERRUPTED] Retry succeeded',
                        },
                      },
                    },
                  );
                } catch (updateError) {
                  console.error(
                    '[generateAgentResponse] Failed to update retry system message on success:',
                    updateError,
                  );
                }
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

      // Fallback: if text is still missing after continue, provide a minimal
      // response so the user always sees something rather than an empty
      // message. EXCEPT when the turn ended on a VALID `request_human_input`
      // gate: that turn intentionally has no trailing text — the question card
      // IS the response — and firing the incomplete-notice here put a spurious
      // "unable to generate a complete response" line under every question
      // card the model asked without a closing sentence.
      if (
        (!result.text?.trim() ||
          needsToolResultRetry(result.text, result.steps)) &&
        !endedOnHumanInputGate(result.steps)
      ) {
        const toolNames = extractToolNamesFromSteps(result.steps ?? []);
        didRetry = true;
        if (result.finishReason === 'tool-calls') {
          // Step budget exhausted with the work still mid-flight — a capacity
          // stop, not a failure. Tell the user neutrally why the turn stopped
          // ([STEP_LIMIT_REACHED], rendered as info), never an error line.
          debugLog('Step budget exhausted, stopping turn', {
            stepCapRounds,
            toolNames,
          });
          // Diagnostic for return-value consumers only (delegate
          // ToolResponses, logs) — never persisted as the assistant's words
          // (see `fallbackNoticeSaved`).
          result.text =
            'I stopped here because the turn reached its step limit. Ask me to continue to pick up where I left off.';
          try {
            await saveMessage(ctx, components.agent, {
              threadId,
              message: {
                role: 'system',
                content:
                  `${SYSTEM_MSG_TAG.STEP_LIMIT_REACHED} ${formatStepLimitBody({ round: stepCapRounds })}`.trim(),
              },
            });
            fallbackNoticeSaved = true;
          } catch (msgError) {
            console.error(
              '[generateAgentResponse] Failed to save step-limit message:',
              msgError,
            );
          }
        } else {
          debugLog('All retries exhausted, using fallback message', {
            toolNames,
            finishReason: result.finishReason,
          });
          // Diagnostic for return-value consumers only (delegate
          // ToolResponses, logs) — never persisted as the assistant's words
          // (see `fallbackNoticeSaved`).
          result.text =
            toolNames.length > 0
              ? `I attempted to process your request using ${toolNames.join(', ')}, but was unable to generate a complete response. Please try again.`
              : 'I was unable to generate a response. Please try again.';
          // Machine-readable body — the chat UI renders a localized warning
          // line (same pattern as MODEL_FALLBACK) instead of an English
          // sentence masquerading as the assistant's own reply.
          try {
            await saveMessage(ctx, components.agent, {
              threadId,
              message: {
                role: 'system',
                content:
                  `${SYSTEM_MSG_TAG.GENERATION_INCOMPLETE} ${formatGenerationIncompleteBody({ tools: toolNames })}`.trim(),
              },
            });
            fallbackNoticeSaved = true;
          } catch (msgError) {
            console.error(
              '[generateAgentResponse] Failed to save generation-incomplete message:',
              msgError,
            );
          }
        }
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
            contextSummary,
          });

          const recoveryAgent = createAgent(agentOptions);

          const recoverySystemPrompt = buildSystemPrompt(
            agentInstructions,
            userPersonalization,
            recoveryContext.threadContext,
            projectInstructionsBlock,
            fallbackLocale,
            instructionsCacheable,
            new Date().toISOString(),
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
                  ...(reasoningProviderOptions
                    ? { providerOptions: reasoningProviderOptions }
                    : {}),
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
              reasoning: recoveryResult.reasoningText ?? result.reasoning,
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
    // original (empty/preamble) text. Update it with the final result — unless
    // the text is the retry-exhausted diagnostic, whose user-facing form is the
    // [GENERATION_INCOMPLETE] system message already saved above (if that save
    // failed, fall through so the user still sees *something*).
    if (
      didRetry &&
      !fallbackNoticeSaved &&
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
    const { timeToFirstReasoningMs, timeFromSendMs } =
      computeReasoningTimings();
    // Pre-answer wall-clock the user actually waited, anchored to the TURN start
    // (markGenerating, before routing) so it includes the Auto-router classifier
    // — what the chat "Thought for Ns" summary should show. Resolved here
    // (post-stream) so the extra read never delays first token. The thinking
    // window closes at the first answer token; a reasoning/tool-only or aborted
    // turn never produces one, so it closes at the turn's end instead — this
    // keeps "Thought for Ns" on those messages after a reload. Turns with no
    // thinking phase at all are gated out by the UI (hasActualThought).
    const resolvedTurnStartMs = await resolveTurnStartMs(
      ctx,
      threadId,
      startTime,
    );
    const thinkingDurationMs = computeThinkingDurationMs(
      firstTokenTime,
      resolvedTurnStartMs,
      Date.now(),
    );

    debugLog('Response generated', {
      durationMs,
      textLength: result.text?.length ?? 0,
      finishReason: result.finishReason,
      stepsCount: result.steps?.length ?? 0,
      timeToFirstTokenMs,
    });

    // Structured performance summary for profiling (T0 instrumentation).
    // The send-relative fields decompose the wait: requestStartMs → this
    // action's setup → preStream handoff → model first-reasoning / first-token.
    debugLog('PERF_SUMMARY', {
      threadId,
      model,
      totalMs: durationMs,
      ttftMs: timeToFirstTokenMs,
      // What the user actually waits for, split into our-overhead vs model-floor.
      timeToFirstReasoningMs,
      timeFromSendMs,
      // Setup inside THIS action (entry → handoff to the LLM).
      preStreamSetupMs:
        preStreamAtMs != null ? preStreamAtMs - startTime : undefined,
      // Our pre-stream overhead measured from send (includes the upstream
      // hops + scheduler tick captured separately in runAgentGeneration).
      preStreamFromSendMs:
        preStreamAtMs != null ? preStreamAtMs - sendStartMs : undefined,
      contextBuildMs,
      ragContextLength: knowledgeContextResult?.text?.length ?? 0,
      webContextLength: webContextResult?.text?.length ?? 0,
      contextTokens: structuredThreadContext.stats.totalTokens,
      messageCount: structuredThreadContext.stats.messageCount,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      // Prompt-cache effectiveness. `cachedInputTokens` is reported by the
      // openai-compatible adapter from `prompt_tokens_details.cached_tokens`
      // (cache READS); cache-write/creation tokens are not surfaced by this
      // adapter, so a low ratio on a thread's first turn is expected.
      cachedInputTokens: result.usage?.cachedInputTokens,
      cacheHitRatio:
        result.usage?.cachedInputTokens != null &&
        result.usage.inputTokens != null &&
        result.usage.inputTokens > 0
          ? Number(
              (
                result.usage.cachedInputTokens / result.usage.inputTokens
              ).toFixed(3),
            )
          : undefined,
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
    const completeContextWindow = buildContextWindowParts(
      structuredThreadContext.threadContext,
    ).join('\n\n');

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
      reasoning: result.reasoning,
      durationMs,
      timeToFirstTokenMs,
      timeToFirstReasoningMs,
      timeFromSendMs,
      thinkingDurationMs,
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

    // The model is reasoning-STEERABLE this turn (has a capability) — true even
    // when the governor chose `off`. We record an outcome for every steerable
    // turn, INCLUDING a self-truncating model parked at `off`: a bad off-turn is
    // exactly the signal that it under-reasoned, and without recording it the
    // class could never climb out of off. `selfTruncates` is undefined only for
    // non-steerable models.
    const reasoningSteered =
      reasoningDecision != null &&
      reasoningDecision.selfTruncates !== undefined;

    // Score the final answer's quality (hedging / specificity / hallucination /
    // length) so the governor's online controller learns from whether the
    // budget produced GOOD answers, not just token counts. The quality profile
    // is fixed at 'balanced' (the manual per-agent override was removed).
    const reasoningQualityScore =
      reasoningSteered && responseResult.text
        ? analyzeResponseQuality({
            text: responseResult.text,
            complexity: reasoningDecision.difficultyClass,
            thresholds: thresholdsFor('balanced'),
            isMathLike: /\d\s*[+\-*/×÷=]\s*\d/.test(responseResult.text),
          }).score
        : undefined;

    // Don't feed a thinking-token sample for a turn that wasn't actually steered
    // to think (a self-truncating model at `off`): a `0` sample would poison the
    // Welford mean ("this class needs 0 tokens") and trap the class at off. The
    // qualityScore still flows, so a bad off-turn can still push it up.
    const recordedReasoningTokens = reasoningDecision?.applied
      ? responseResult.usage?.reasoningTokens
      : undefined;

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
            reasoning: responseResult.reasoning,
            durationMs,
            timeToFirstTokenMs,
            timeToFirstReasoningMs,
            timeFromSendMs,
            thinkingDurationMs,
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
          autoRouteReason,
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
        // Adaptive Reasoning Governor (Layer C): fold this turn's outcome into
        // the thread's learned state so the next turn converges toward the
        // model's revealed need. Recorded for every steerable turn (incl. a
        // self-truncating model parked at `off`).
        reasoningSteered
          ? ctx
              .runMutation(
                internal.threads.internal_mutations.updateThreadReasoningState,
                {
                  threadId,
                  difficultyClass: reasoningDecision.difficultyClass,
                  budgetTokens: reasoningDecision.budgetTokens,
                  selfTruncates: reasoningDecision.selfTruncates ?? false,
                  reasoningTokens: recordedReasoningTokens,
                  outputTokens: responseResult.usage?.outputTokens,
                  intensity: reasoningDecision.intensity,
                  finishReason: responseResult.finishReason,
                  retried: didRetry,
                  qualityScore: reasoningQualityScore,
                  chosenTier: reasoningDecision.tier,
                },
              )
              .catch((reasoningErr: unknown) =>
                console.warn(
                  '[reasoning] thread state update failed:',
                  reasoningErr instanceof Error
                    ? reasoningErr.message
                    : reasoningErr,
                ),
              )
          : Promise.resolve(),
        // Also fold the outcome into the cross-thread profile (per org + model)
        // so future threads — and the stateless API path — warm-start from it.
        reasoningSteered && organizationId
          ? ctx
              .runMutation(
                internal.threads.internal_mutations.updateReasoningProfile,
                {
                  organizationId,
                  scopeKey: reasoningScopeKey(model, agentType),
                  difficultyClass: reasoningDecision.difficultyClass,
                  budgetTokens: reasoningDecision.budgetTokens,
                  selfTruncates: reasoningDecision.selfTruncates ?? false,
                  reasoningTokens: recordedReasoningTokens,
                  outputTokens: responseResult.usage?.outputTokens,
                  intensity: reasoningDecision.intensity,
                  finishReason: responseResult.finishReason,
                  retried: didRetry,
                  qualityScore: reasoningQualityScore,
                  chosenTier: reasoningDecision.tier,
                },
              )
              .catch((profileErr: unknown) =>
                console.warn(
                  '[reasoning] profile update failed:',
                  profileErr instanceof Error ? profileErr.message : profileErr,
                ),
              )
          : Promise.resolve(),
        // Auto-compaction: when this turn's REAL prompt input crossed ~90% of
        // the model's effective CONTEXT WINDOW (not the smaller history budget —
        // that fired far too early since the prompt also holds the system
        // prompt, tools, and RAG/web), schedule a background summarization of the
        // oldest turns so future turns stay within the window without dropping
        // context. Top-level threads only (sub-agent delegate threads, which
        // carry a `parentThreadId`, are ephemeral) — this covers streaming chat
        // AND non-streaming API/Slack/webhook turns. Runs as a separate
        // scheduled action (no added latency); best-effort, drop-oldest is the
        // safety net.
        !parentThreadId &&
        organizationId &&
        shouldCompact(
          responseResult.usage?.inputTokens,
          resolveEffectiveContextWindow({
            contextWindow: modelContextWindow,
            governanceMaxContext:
              governanceMaxContext && governanceMaxContext > 0
                ? governanceMaxContext
                : undefined,
          }),
        )
          ? ctx.scheduler
              .runAfter(
                0,
                internal.lib.context_management.compaction.summarize
                  .compactThreadHistory,
                { threadId, organizationId, budget: effectiveMaxHistoryTokens },
              )
              .then(() => undefined)
              .catch((compactErr: unknown) =>
                console.warn(
                  '[compaction] schedule failed:',
                  compactErr instanceof Error ? compactErr.message : compactErr,
                ),
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
        // Stamp a structured, machine-readable envelope on the error so the
        // chat UI can render an authoritative, localized, provider-specific
        // message instead of regex-guessing the raw provider string.
        const errorCode = classifyChatErrorCode(error);
        const failedError = encodeChatError({
          code: errorCode,
          provider,
          model,
          raw: errorMessage || 'Unknown error',
        });
        // Poisoned catalog/cache rows have set max_tokens to the full context
        // window; clear that model's cached cap so the next turn uses the
        // safe default instead of replaying the same failure.
        if (errorCode === 'output_cap_too_high' && model) {
          try {
            await ctx.runMutation(
              internal.model_catalog.mutations.clearModelMaxOutputTokens,
              { modelId: model },
            );
          } catch (clearErr) {
            console.warn(
              '[generateAgentResponse] failed to clear poisoned maxOutputTokens cache:',
              clearErr,
            );
          }
        }

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
              error: failedError,
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
                error: failedError,
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
        // Persist the thinking window even for an aborted/errored turn that
        // never produced a first answer token: it closes at the turn's end so
        // the reloaded message still shows "Thought for Ns" (see the success
        // path above for the full rationale).
        const resolvedTurnStartMs = await resolveTurnStartMs(
          ctx,
          threadId,
          startTime,
        );
        const thinkingDurationMs = computeThinkingDurationMs(
          firstTokenTime,
          resolvedTurnStartMs,
          Date.now(),
        );
        const { toolCalls, toolsUsage, citations } = extractToolCallsFromSteps(
          result.steps ?? [],
        );
        const contextWindowParts = buildContextWindowParts(
          structuredThreadContext?.threadContext,
        );

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
            reasoning: result.reasoning,
            durationMs,
            timeToFirstTokenMs: firstTokenTime
              ? firstTokenTime - startTime
              : undefined,
            ...computeReasoningTimings(),
            thinkingDurationMs,
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
          autoRouteReason,
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

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export {
  endedOnHumanInputGate,
  needsToolResultRetry,
  shouldRetryGeneration,
} from './retry_policy';
