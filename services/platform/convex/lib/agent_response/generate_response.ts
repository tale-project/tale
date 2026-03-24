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

import type { StreamMessage } from '@convex-dev/agent/validators';
import type { ModelMessage } from 'ai';

import {
  abortStream,
  listMessages,
  listStreams,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';

import type {
  GenerateResponseConfig,
  GenerateResponseArgs,
  GenerateResponseResult,
  BeforeContextResult,
} from './types';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { queryRagContext } from '../../agent_tools/rag/query_rag_context';
import { queryWebContext } from '../../agent_tools/web/helpers/query_web_context';
import { onAgentComplete } from '../agent_completion';
import {
  buildStructuredContext,
  AGENT_CONTEXT_CONFIGS,
  RECOVERY_TIMEOUT_MS,
  estimateTokens,
} from '../context_management';
import { wrapInDetails } from '../context_management/message_formatter';
import { createDebugLog } from '../debug_log';
import { resolveTemplateVariables } from './resolve_template_variables';
import { STRUCTURED_RESPONSE_INSTRUCTIONS } from './structured_response_instructions';
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
const ABORT_POLL_INTERVAL_MS = 200;

interface AbortWatcher {
  stop: () => void;
  readonly cancelled: boolean;
}

/**
 * Polls the stream status for cancellation and aborts the controller when
 * detected. This bridges the gap between the `cancelGeneration` mutation
 * (which sets the DB flag) and the running action (which needs an
 * AbortSignal to stop the AI SDK / DeltaStreamer).
 *
 * `baselineAbortedIds` contains stream IDs that were already aborted before
 * this generation started. The watcher ignores these so that stale aborted
 * streams from previous cancellations don't immediately kill a new generation.
 *
 * `baselineNewestAssistantId` is the ID of the newest *failed* assistant
 * message in the thread when this generation started. If `cancelGeneration`
 * runs before any stream exists, it creates a failed assistant message. The
 * watcher detects this by checking whether a NEW failed assistant message
 * (different from the baseline) appeared. Only `status === 'failed'` messages
 * are considered, so the SDK's own assistant messages (created during normal
 * generation) are never confused with cancellation signals.
 */
function startAbortWatcher(
  ctx: GenerateResponseArgs['ctx'],
  threadId: string,
  abortController: AbortController,
  baselineAbortedIds: Set<string>,
  baselineNewestAssistantId: string | undefined,
): AbortWatcher {
  let stopped = false;
  let cancelledByWatcher = false;
  let earlyCheckDone = false;
  let earlyCheckCount = 0;
  const MAX_EARLY_CHECK_POLLS = 50; // ~10s at 200ms interval

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

      // Check 2: early cancellation — cancelGeneration creates a failed
      // assistant message when no streams exist yet. Only need to check
      // until the SDK creates its own stream (first few polls).
      if (!earlyCheckDone) {
        earlyCheckCount++;
        const msgs = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { numItems: 5, cursor: null },
          excludeToolMessages: true,
        });
        const newestFailedAssistant = msgs.page.find(
          (m: MessageDoc) =>
            m.message?.role === 'assistant' && m.status === 'failed',
        );
        if (
          newestFailedAssistant &&
          newestFailedAssistant._id !== baselineNewestAssistantId
        ) {
          cancelledByWatcher = true;
          abortController.abort();
          return;
        }
        // Once the SDK starts streaming it creates its own message,
        // making this check unreliable. Switch to stream-only checks.
        // Also stop after MAX_EARLY_CHECK_POLLS to bound polling.
        if (
          streams.length > baselineAbortedIds.size ||
          earlyCheckCount >= MAX_EARLY_CHECK_POLLS
        ) {
          earlyCheckDone = true;
        }
      }
    } catch {
      // Query failure is non-fatal; will retry on next poll
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
    knowledgeFileIds,
    structuredResponsesEnabled,
    instructions,
    toolsSummary,
  } = config;
  const {
    ctx,
    threadId,
    userId,
    organizationId,
    promptMessage,
    additionalContext,
    userContext,
    parentThreadId,
    agentOptions,
    streamId,
    promptMessageId,
    maxSteps: _maxSteps,
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

    // Snapshot existing aborted streams and the newest assistant message
    // so the watcher can distinguish stale state from new cancellations.
    let baselineNewestAssistantId: string | undefined;
    if (enableStreaming) {
      try {
        const existing = await ctx.runQuery(components.agent.streams.list, {
          threadId,
          statuses: ['aborted'] as const,
        });
        baselineAbortedIds = new Set(
          existing.map((s: { streamId: string }) => s.streamId),
        );
      } catch {
        // Non-fatal — watcher will still work, just without baseline filter
      }
      try {
        const msgs = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { numItems: 5, cursor: null },
          excludeToolMessages: true,
        });
        const newestFailedAssistant = msgs.page.find(
          (m: MessageDoc) =>
            m.message?.role === 'assistant' && m.status === 'failed',
        );
        baselineNewestAssistantId = newestFailedAssistant?._id;
      } catch {
        // Non-fatal
      }
    }

    // Start abort watcher for streaming mode — polls the stream status
    // and triggers abortController when the user cancels via cancelGeneration.
    abortWatcher = enableStreaming
      ? startAbortWatcher(
          ctx,
          threadId,
          abortController,
          baselineAbortedIds,
          baselineNewestAssistantId,
        )
      : undefined;

    // Direct DB check for cancellation — closes the 200ms polling gap
    // that abortWatcher?.cancelled can miss.
    const checkFreshAbort = async (): Promise<boolean> => {
      if (abortWatcher?.cancelled) return true;
      try {
        const streams = await ctx.runQuery(components.agent.streams.list, {
          threadId,
          statuses: ['aborted'] as const,
        });
        if (
          streams.some(
            (s: { streamId: string }) => !baselineAbortedIds.has(s.streamId),
          )
        ) {
          return true;
        }
        // Fallback: detect cancel via newly-failed assistant message.
        // Only runs when no aborted streams found (keeps common-case cost zero).
        // Covers the cancel-during-continue gap where no SDK streams exist to abort.
        const msgs = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { numItems: 3, cursor: null },
          excludeToolMessages: true,
        });
        const latestAssistant = msgs.page.find(
          (m: MessageDoc) => m.message?.role === 'assistant',
        );
        return (
          latestAssistant?.status === 'failed' &&
          latestAssistant._id !== baselineNewestAssistantId
        );
      } catch {
        return false;
      }
    };

    // Determine retrieval modes
    const knowledgeMode = configKnowledgeMode ?? 'off';
    const webSearchMode = configWebSearchMode ?? 'off';
    const needsKnowledgeContext =
      knowledgeMode === 'context' || knowledgeMode === 'both';
    const needsWebContext =
      webSearchMode === 'context' || webSearchMode === 'both';

    // Start context injection queries (non-blocking) for context/both modes
    let knowledgeContextPromise: Promise<string | undefined> | undefined;
    if (needsKnowledgeContext && organizationId && promptMessage) {
      const accessibleFileIds: string[] = await ctx.runQuery(
        internal.documents.internal_queries.getAgentScopedFileIds,
        {
          organizationId,
          agentTeamId,
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

    let webContextPromise: Promise<string | undefined> | undefined;
    if (needsWebContext && organizationId && promptMessage) {
      webContextPromise = queryWebContext(ctx, organizationId, promptMessage);
      debugLog('Web context query started', {
        threadId,
        elapsedMs: Date.now() - startTime,
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
    const [knowledgeContextResult, webContextResult] = await Promise.all([
      knowledgeContextPromise ?? Promise.resolve(undefined),
      webContextPromise ?? Promise.resolve(undefined),
    ]);

    if (knowledgeContextResult) {
      debugLog('Knowledge context injected', {
        contextLength: knowledgeContextResult.length,
        elapsedMs: Date.now() - startTime,
      });
    }
    if (webContextResult) {
      debugLog('Web context injected', {
        contextLength: webContextResult.length,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Build structured context (history, RAG, web)
    // Note: promptMessage is NOT included - it's passed via `prompt` parameter
    const agentConfig = AGENT_CONTEXT_CONFIGS[agentType];
    structuredThreadContext = await buildStructuredContext({
      ctx,
      threadId,
      additionalContext,
      parentThreadId,
      maxHistoryTokens: agentConfig.maxHistoryTokens,
      ragContext: knowledgeContextResult ?? hookData?.ragContext,
      webContext: webContextResult,
    });

    debugLog('Context built', {
      estimatedTokens: structuredThreadContext.stats.totalTokens,
      messageCount: structuredThreadContext.stats.messageCount,
      elapsedMs: Date.now() - startTime,
    });

    // Hook can override prompt content (e.g., for attachments → ModelMessage[])
    let hookPromptContent: string | ModelMessage[] | undefined;

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
      structuredResponsesEnabled !== false
        ? `${resolvedInstructions}\n\n${STRUCTURED_RESPONSE_INSTRUCTIONS}`
        : resolvedInstructions;
    const systemPrompt = agentInstructions
      ? `${agentInstructions}\n\n${structuredThreadContext.threadContext}`
      : structuredThreadContext.threadContext;

    debugLog('PRE_LLM_CALL', {
      threadId,
      model,
      enableStreaming,
      promptMessageId,
      system: systemPrompt,
      prompt: promptToSend,
      effectiveTimeoutMs,
      actionDeadline: new Date(actionDeadline).toISOString(),
      elapsedMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    try {
      if (enableStreaming) {
        // Streaming mode (chat agent)
        // - system: thread context (history, RAG, web search)
        // - prompt: current user message (passed separately to avoid duplication)
        const streamResult = await agent.streamText(
          contextWithOrg,
          { threadId, userId },
          {
            promptMessageId,
            system: systemPrompt,
            prompt: promptToSend,
            abortSignal: abortController.signal,
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
            saveStreamDeltas: { chunking: 'line', throttleMs: 200 },
          },
        );

        savedMessageId = streamResult.savedMessages?.[0]?._id;

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

        // Post-success abort check: direct DB query closes the 200ms
        // polling gap that the watcher flag alone can miss.
        if (await checkFreshAbort()) {
          abortWatcher?.stop();
          return {
            threadId,
            text: '',
            durationMs: Date.now() - startTime,
            finishReason: 'cancelled',
          };
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
              prompt: promptMessage,
              abortSignal: abortController.signal,
              ...(promptMessageId ? { promptMessageId } : {}),
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
        if (await checkFreshAbort()) {
          abortWatcher?.stop();
          return {
            threadId,
            text: '',
            durationMs: Date.now() - startTime,
            finishReason: 'cancelled',
          };
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

          const continueContext = await buildStructuredContext({
            ctx,
            threadId,
            additionalContext,
            parentThreadId,
            maxHistoryTokens: agentConfig.maxHistoryTokens,
            ragContext: hookData?.ragContext,
          });

          const continueAgent = createAgent(agentOptions);

          const continueSystemPrompt = agentInstructions
            ? `${agentInstructions}\n\n${continueContext.threadContext}`
            : continueContext.threadContext;

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
                includeTeamKnowledge,
                includeOrgKnowledge,
                knowledgeFileIds,
                ...(parentThreadId ? { parentThreadId } : {}),
              };

          // Check for cancellation before starting continue (catches cancels during context building)
          if (await checkFreshAbort()) {
            abortWatcher?.stop();
            return {
              threadId,
              text: '',
              durationMs: Date.now() - startTime,
              finishReason: 'cancelled',
            };
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
      if (await checkFreshAbort()) {
        abortWatcher?.stop();
        return {
          threadId,
          text: '',
          durationMs: Date.now() - startTime,
          finishReason: 'cancelled',
        };
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
            maxHistoryTokens: agentConfig.maxHistoryTokens,
            ragContext: hookData?.ragContext,
          });

          const recoveryAgent = createAgent(agentOptions);

          const recoverySystemPrompt = agentInstructions
            ? `${agentInstructions}\n\n${recoveryContext.threadContext}`
            : recoveryContext.threadContext;

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
      !(await checkFreshAbort())
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

    // Extract tool calls from steps
    const { toolCalls, toolsUsage } = extractToolCallsFromSteps(
      result.steps ?? [],
    );

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
      contextWindow: completeContextWindow,
      contextStats,
      model: actualModel,
      provider,
    };

    // Final abort check before post-processing — direct DB query
    // closes the polling gap the watcher alone can miss.
    if (await checkFreshAbort()) {
      abortWatcher?.stop();
      return {
        threadId,
        text: '',
        durationMs,
        finishReason: 'cancelled',
      };
    }

    // Call afterGenerate hook if provided
    if (hooks?.afterGenerate) {
      await hooks.afterGenerate(ctx, args, responseResult, hookData);
    }

    // Call unified completion handler (saves metadata + schedules summarization)
    await onAgentComplete(ctx, {
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
        contextWindow: completeContextWindow,
        contextStats: responseResult.contextStats,
      },
    });

    // Link approvals to message (only for main agent, not sub-agents)
    if (!parentThreadId && savedMessageId) {
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

        if (latestAssistantMessage) {
          const currentOrder = latestAssistantMessage.order;
          const firstAssistantInOrder =
            messagesResult.page
              .filter(
                (m: MessageDoc) =>
                  m.order === currentOrder && m.message?.role === 'assistant',
              )
              .sort(
                (a: MessageDoc, b: MessageDoc) => a.stepOrder - b.stepOrder,
              )[0] ?? latestAssistantMessage;

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
        }
      } catch (error) {
        console.error(
          '[generateAgentResponse] Failed to link approvals to message:',
          error,
        );
      }
    }

    // Complete stream if streamId provided (skip if user cancelled —
    // appending would concatenate fallback text onto already-streamed content)
    if (streamId && !(await checkFreshAbort())) {
      if (responseResult.text) {
        await ctx.runMutation(
          internal.streaming.internal_mutations.appendToStream,
          {
            streamId,
            text: responseResult.text,
          },
        );
      }
      await ctx.runMutation(
        internal.streaming.internal_mutations.completeStream,
        { streamId },
      );
    }
    if (streamId) {
      await ctx.runMutation(
        internal.threads.internal_mutations.clearGenerationStatus,
        { threadId, streamId },
      );
    }

    abortWatcher?.stop();
    return responseResult;
  } catch (error) {
    abortWatcher?.stop();

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

    // Single query for both aborted and streaming SDK streams, then
    // partition locally to check cancellation and clean up zombies.
    let userCancelled = false;
    let stuckStreams: StreamMessage[] = [];
    try {
      const allStreams = await listStreams(ctx, components.agent, {
        threadId,
        includeStatuses: ['aborted', 'streaming'],
      });
      userCancelled = allStreams.some(
        (s) => s.status === 'aborted' && !baselineAbortedIds.has(s.streamId),
      );
      if (!userCancelled) {
        stuckStreams = allStreams.filter((s) => s.status === 'streaming');
      }
    } catch (streamQueryError) {
      console.error(
        '[generateAgentResponse] Failed to query stream statuses:',
        streamQueryError,
      );
    }

    // Mark persistent text stream as errored (skip if user cancelled)
    if (streamId && !userCancelled) {
      try {
        await ctx.runMutation(
          internal.streaming.internal_mutations.errorStream,
          { streamId },
        );
      } catch (streamError) {
        console.error(
          '[generateAgentResponse] Failed to mark stream as errored:',
          streamError,
        );
      }
    }

    // Clear generation status so isThreadGenerating returns false
    if (streamId) {
      try {
        await ctx.runMutation(
          internal.threads.internal_mutations.clearGenerationStatus,
          { threadId, streamId },
        );
      } catch (clearError) {
        console.error(
          '[generateAgentResponse] Failed to clear generation status:',
          clearError,
        );
      }
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

    // Save failed message — skip if cancelGeneration already created one
    let failedMessageId: string | undefined;
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
        const { messageId: failedMsgId } = await saveMessage(
          ctx,
          components.agent,
          {
            threadId,
            message: {
              role: 'assistant',
              content:
                'I was unable to complete your request. Please try again.',
            },
            metadata: {
              status: 'failed',
              error: errorMessage || 'Unknown error',
            },
          },
        );
        failedMessageId = failedMsgId;
      } else {
        failedMessageId = newestAssistant._id;
      }
    } catch (saveError) {
      console.error(
        '[generateAgentResponse] Failed to save failed message:',
        saveError,
      );
    }

    // Record partial metadata for debugging even on failure
    const metadataMessageId = savedMessageId ?? failedMessageId;
    if (metadataMessageId) {
      try {
        const durationMs = Date.now() - startTime;
        const { toolCalls, toolsUsage } = extractToolCallsFromSteps(
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
            contextWindow:
              contextWindowParts.length > 0
                ? contextWindowParts.join('\n\n')
                : undefined,
            contextStats: structuredThreadContext?.stats,
            error: errorMessage || 'Unknown error',
          },
        });
      } catch (metadataError) {
        console.error(
          '[generateAgentResponse] Failed to save error metadata:',
          metadataError,
        );
      }
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
  } catch {
    return '[unserializable]';
  }
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
  }> = [];

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

      const inputStr = safeStringify(toolCall.input ?? toolCall.args);
      const outputStr = safeStringify(
        matchingResult?.output ?? matchingResult?.result,
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
      }

      toolsUsage.push(usageEntry);
    }
  }

  return { toolCalls, toolsUsage };
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
  'cancelled',
  'content-filter',
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

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export { shouldRetryGeneration, needsToolResultRetry };
