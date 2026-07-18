/**
 * Structured Context Builder
 *
 * Builds a fully structured context window using HTML <details> elements:
 * 1. Querying message history from Agent SDK
 * 2. Querying related approvals (including human_input_request)
 * 3. Formatting all content with collapsible <details> sections
 * 4. Returning a single system message with the complete context
 */

import { listMessages, type MessageDoc } from '@convex-dev/agent';

import { isRecord } from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { DEFAULT_MAX_HISTORY_TOKENS } from './constants';
import { estimateMessageDocTokens, estimateTokens } from './estimate_tokens';
import type { ToolOutputAge } from './message_formatter';
import * as fmt from './message_formatter';

/**
 * Approval item from the approvals table.
 * Note: Intentionally duplicated from shared/schemas/approvals.ts to avoid
 * cross-module dependencies. Keep in sync with the shared schema.
 */
interface ApprovalItem {
  _id: string;
  _creationTime: number;
  messageId?: string;
  resourceType: string;
  status: string;
  metadata?: Record<string, unknown>;
}

/**
 * Human input request metadata structure
 */
interface HumanInputRequestMetadata {
  question: string;
  context?: string;
  fields: Array<{
    label: string;
    description?: string;
    required?: boolean;
    type: string;
    options?: Array<{
      label: string;
      description?: string;
      value?: string;
    }>;
  }>;
  requestedAt: number;
  response?: {
    value: string | string[];
    respondedBy: string;
    timestamp: number;
  };
}

function isHumanInputRequestMetadata(
  val: unknown,
): val is HumanInputRequestMetadata {
  if (!isRecord(val)) return false;
  return (
    typeof val.question === 'string' &&
    Array.isArray(val.fields) &&
    typeof val.requestedAt === 'number'
  );
}

/**
 * Tool call extracted from message content
 */
interface ExtractedToolCall {
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

/**
 * Tool result extracted from message content
 */
interface ExtractedToolResult {
  toolName?: string;
  toolCallId?: string;
  result: unknown;
  isError?: boolean;
}

/** Chronological ordering: by `order`, then `stepOrder` within the same turn. */
function byChronologicalOrder(a: MessageDoc, b: MessageDoc): number {
  return a.order !== b.order ? a.order - b.order : a.stepOrder - b.stepOrder;
}

/**
 * Result from building structured context
 */
export interface StructuredContextResult {
  /** Thread context as a string (history, RAG, etc.) */
  threadContext: string;
  stats: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasRag: boolean;
    hasWebContext: boolean;
  };
}

/**
 * Parameters for building structured context
 */
export interface BuildStructuredContextParams {
  ctx: ActionCtx;
  threadId: string;
  ragContext?: string;
  webContext?: string;
  /** Pre-built artifacts XML block to inject (from buildArtifactsContext). */
  artifactsContext?: string;
  /** Token budget for conversation history. Conversational messages (user/assistant/system)
   * are loaded first; remaining budget is filled with tool messages (newest first). */
  maxHistoryTokens?: number;
  /** Additional structured context as key-value pairs */
  additionalContext?: Record<string, string>;
  /** Parent thread ID (for sub-agent mode, indicates this is a delegated task) */
  parentThreadId?: string;
  /** ID of the message being sent as the `prompt` parameter to the LLM.
   *  When set, only this message is excluded from history (to avoid duplication).
   *  Without it the builder falls back to skipping the last user message, which
   *  can drop context when the prompt is actually a system message (e.g. location
   *  response). */
  promptMessageId?: string;
  /** Auto-compaction rolling summary (from `threadMetadata.contextSummary`).
   *  When present, messages with `order <= coversThroughOrder` are represented
   *  by `text` instead of being loaded verbatim, and `text` is injected as an
   *  "earlier conversation, condensed" block ahead of the recent turns. */
  contextSummary?: { text: string; coversThroughOrder: number };
  /** Pre-loaded history (from {@link loadStructuredHistory}): lets the caller
   *  start the paginated message load CONCURRENTLY with other context work
   *  (RAG, personalization) instead of serially after it — the load depends
   *  only on the thread, the token budget, and the summary boundary, never on
   *  those other legs. When absent the builder loads internally (retry and
   *  recovery paths keep that). */
  preloadedHistory?: StructuredHistoryBundle;
}

/** History bundle produced by {@link loadStructuredHistory} and consumed via
 *  `preloadedHistory` — the load half of `buildStructuredContext`, split out
 *  so it can overlap the context `Promise.all` on the hot path. */
export interface StructuredHistoryBundle {
  messages: MessageDoc[];
  toolMessageAges: Map<string, ToolOutputAge>;
  approvals: ApprovalItem[] | null;
}

/**
 * Load message history and approvals in parallel (independent queries).
 * Messages already folded into the rolling summary are excluded so they
 * aren't double-counted against the budget (the summary stands in).
 */
export async function loadStructuredHistory(
  ctx: ActionCtx,
  threadId: string,
  maxHistoryTokens: number,
  summarizedThroughOrder?: number,
): Promise<StructuredHistoryBundle> {
  const [{ messages, toolMessageAges }, approvals] = await Promise.all([
    loadPrioritizedMessages(
      ctx,
      threadId,
      maxHistoryTokens,
      summarizedThroughOrder,
    ),
    ctx.runQuery(internal.approvals.internal_queries.getApprovalsForThread, {
      threadId,
    }),
  ]);
  return { messages, toolMessageAges, approvals };
}

/**
 * Build a fully structured context window: thread message history and related
 * approvals formatted into collapsible <details> sections, returned as a single
 * context string plus token/count stats.
 */
export async function buildStructuredContext(
  params: BuildStructuredContextParams,
): Promise<StructuredContextResult> {
  const {
    ctx,
    threadId,
    ragContext,
    webContext,
    artifactsContext,
    maxHistoryTokens = DEFAULT_MAX_HISTORY_TOKENS,
    additionalContext,
    parentThreadId,
    promptMessageId,
    contextSummary,
  } = params;

  const { messages, toolMessageAges, approvals } =
    params.preloadedHistory ??
    (await loadStructuredHistory(
      ctx,
      threadId,
      maxHistoryTokens,
      contextSummary?.coversThroughOrder,
    ));

  const contextParts: string[] = [];

  if (parentThreadId) {
    contextParts.push(fmt.formatParentThread(parentThreadId));
  }

  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      if (value) {
        contextParts.push(fmt.formatAdditionalContext(key, value));
      }
    }
  }

  if (ragContext) {
    contextParts.push(fmt.formatKnowledgeBase(ragContext));
  }

  if (webContext) {
    contextParts.push(fmt.formatWebContext(webContext));
  }

  if (artifactsContext) {
    contextParts.push(fmt.formatArtifactsContext(artifactsContext));
  }

  // Inject the rolling summary (compacted earlier conversation) just before the
  // recent verbatim turns, so the model treats it as established context.
  if (contextSummary?.text.trim()) {
    contextParts.push(
      `<conversation_summary>\nThe earlier part of this conversation has been condensed to stay within the context window. Treat the following as established, factual context from earlier turns:\n${contextSummary.text}\n</conversation_summary>`,
    );
  }

  const { historyMessages } = formatMessagesWithApprovals(
    messages,
    approvals ?? [],
    toolMessageAges,
    promptMessageId,
  );
  if (historyMessages.length > 0) {
    contextParts.push(fmt.formatHistorySection(historyMessages.join('\n\n')));
  }

  const contextText = contextParts.join('\n\n');

  const stats = {
    totalTokens: estimateTokens(contextText),
    messageCount: messages.length,
    approvalCount: approvals?.length ?? 0,
    hasRag: !!ragContext,
    hasWebContext: !!webContext,
  };

  return {
    threadContext: contextText,
    stats,
  };
}

/**
 * Maximum tokens a single message can consume (50% of budget).
 * Prevents a single enormous message from starving the entire history.
 */
const MAX_SINGLE_MESSAGE_BUDGET_RATIO = 0.5;

/**
 * Page size for loading messages from the thread.
 */
const MESSAGE_PAGE_SIZE = 100;

/**
 * Assign age tiers to tool messages based on their position in the list.
 * First 30% → recent, next 40% → mid, rest → old.
 */
function assignToolAges(
  toolMessages: MessageDoc[],
): Map<string, ToolOutputAge> {
  const ages = new Map<string, ToolOutputAge>();
  const total = toolMessages.length;
  if (total === 0) return ages;

  const recentBoundary = Math.ceil(total * 0.3);
  const midBoundary = Math.ceil(total * 0.7);

  for (let i = 0; i < total; i++) {
    let age: ToolOutputAge;
    if (i < recentBoundary) {
      age = 'recent';
    } else if (i < midBoundary) {
      age = 'mid';
    } else {
      age = 'old';
    }
    ages.set(toolMessages[i]._id, age);
  }
  return ages;
}

interface PrioritizedMessagesResult {
  messages: MessageDoc[];
  toolMessageAges: Map<string, ToolOutputAge>;
}

/**
 * Load messages with priority: conversational messages (user/assistant/system) first,
 * then fill remaining token budget with tool messages (newest first).
 * Returns messages sorted chronologically by (order, stepOrder).
 */
async function loadPrioritizedMessages(
  ctx: ActionCtx,
  threadId: string,
  maxTokens: number,
  /** Exclude messages with `order <= this` — they are represented by the
   *  rolling compaction summary and must not be reloaded verbatim. */
  summarizedThroughOrder?: number,
): Promise<PrioritizedMessagesResult> {
  const allMessages: MessageDoc[] = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor, numItems: MESSAGE_PAGE_SIZE },
      excludeToolMessages: false,
    });
    for (const m of result.page) {
      // Drop messages already folded into the rolling summary.
      if (summarizedThroughOrder == null || m.order > summarizedThroughOrder) {
        allMessages.push(m);
      }
    }
    cursor = result.continueCursor;
    isDone = result.isDone;

    // Stop paginating once we hold > 2x the budget in raw tokens; messages are
    // newest-first, so anything beyond that can't fit and isn't worth loading.
    const rawTokens = allMessages.reduce(
      (sum, m) => sum + estimateMessageDocTokens(m),
      0,
    );
    if (rawTokens > maxTokens * 2) break;
  }

  // Partition into conversational vs tool messages, preserving newest-first order.
  const conversational: MessageDoc[] = [];
  const toolMessages: MessageDoc[] = [];
  for (const msg of allMessages) {
    if (msg.message?.role === 'tool') {
      toolMessages.push(msg);
    } else {
      conversational.push(msg);
    }
  }

  // Phase 1: Accept conversational messages (newest first) within budget
  const accepted = new Set<string>();
  let usedTokens = 0;
  const maxSingleMessage = Math.floor(
    maxTokens * MAX_SINGLE_MESSAGE_BUDGET_RATIO,
  );

  for (const msg of conversational) {
    // Cap an oversized single message so it can't starve the whole history.
    const tokens = Math.min(estimateMessageDocTokens(msg), maxSingleMessage);
    // Always include at least one conversational message before budget cutoff.
    if (usedTokens + tokens > maxTokens && accepted.size > 0) break;
    accepted.add(msg._id);
    usedTokens += tokens;
  }

  // Phase 2: Fill remaining budget with tool messages (newest first)
  const remainingTokens = maxTokens - usedTokens;
  const acceptedToolMessages: MessageDoc[] = [];

  if (remainingTokens > 0) {
    let toolTokensUsed = 0;
    for (const msg of toolMessages) {
      const tokens = estimateMessageDocTokens(msg);
      if (toolTokensUsed + tokens > remainingTokens) break;
      accepted.add(msg._id);
      acceptedToolMessages.push(msg);
      toolTokensUsed += tokens;
    }
  }

  const toolMessageAges = assignToolAges(acceptedToolMessages);

  const result = allMessages
    .filter((m) => accepted.has(m._id))
    .sort(byChronologicalOrder);

  return { messages: result, toolMessageAges };
}

/**
 * Result from formatting messages with approvals
 */
interface FormattedMessagesResult {
  historyMessages: string[];
}

/**
 * Format messages with approvals interleaved by timestamp.
 * Separates the current user message (latest) from history.
 */
function formatMessagesWithApprovals(
  messages: MessageDoc[],
  approvals: ApprovalItem[],
  toolMessageAges?: Map<string, ToolOutputAge>,
  promptMessageId?: string,
): FormattedMessagesResult {
  const result: string[] = [];

  const approvalsByMessageId = new Map<string, ApprovalItem[]>();
  for (const approval of approvals) {
    if (approval.messageId) {
      const existing = approvalsByMessageId.get(approval.messageId) ?? [];
      existing.push(approval);
      approvalsByMessageId.set(approval.messageId, existing);
    }
  }

  // Pending tool calls, matched against later tool-result messages by id.
  const pendingToolCalls = new Map<string, ExtractedToolCall>();

  const sortedMessages = [...messages].sort(byChronologicalOrder);

  // Determine which user message to skip (it's passed via `prompt` parameter,
  // not in context). When `promptMessageId` is provided we skip only the exact
  // message being used as the prompt — this avoids dropping the original user
  // question when the prompt is actually a system message (e.g. location
  // response). Without an explicit ID we fall back to the last user message.
  const skipMessageId = promptMessageId;
  let lastUserMsgIndex = -1;
  if (!skipMessageId) {
    for (let i = sortedMessages.length - 1; i >= 0; i--) {
      if (sortedMessages[i].message?.role === 'user') {
        lastUserMsgIndex = i;
        break;
      }
    }
  }

  for (let i = 0; i < sortedMessages.length; i++) {
    const msg = sortedMessages[i];
    const timestamp = msg._creationTime;
    const message = msg.message;

    if (!message) continue;

    // Skip the message being sent as `prompt` (any role) to avoid duplication
    if (skipMessageId && msg._id === skipMessageId) continue;

    if (message.role === 'user') {
      const content = extractTextContent(message.content);
      // Fallback when no explicit promptMessageId: skip the last user message,
      // which is assumed to be passed via the `prompt` parameter.
      const isFallbackPrompt = !skipMessageId && i === lastUserMsgIndex;
      if (content && !isFallbackPrompt) {
        result.push(fmt.formatUserMessage(content, timestamp));
      }
    } else if (message.role === 'assistant') {
      const textContent = extractTextContent(message.content);
      if (textContent) {
        result.push(fmt.formatAssistantMessage(textContent, timestamp));
      }

      const toolCalls = extractToolCalls(message.content);
      for (const tc of toolCalls) {
        if (tc.toolCallId) {
          pendingToolCalls.set(tc.toolCallId, tc);
        }
        // Inline result present: format as a non-mimicable summary.
        if (tc.output !== undefined) {
          const age = toolMessageAges?.get(msg._id);
          result.push(
            fmt.formatToolCallSummary(
              tc.toolName,
              tc.output,
              timestamp,
              tc.isError ? 'error' : 'success',
              age,
            ),
          );
        }
      }

      const linkedApprovals = approvalsByMessageId.get(msg._id);
      if (linkedApprovals) {
        for (const approval of linkedApprovals) {
          if (approval.resourceType === 'human_input_request') {
            const metadata = isHumanInputRequestMetadata(approval.metadata)
              ? approval.metadata
              : undefined;
            if (metadata) {
              result.push(
                fmt.formatHumanInputRequest(
                  approval._id,
                  metadata.question,
                  metadata.fields,
                  metadata.context,
                  metadata.requestedAt,
                ),
              );

              if (metadata.response) {
                result.push(
                  fmt.formatHumanResponse(
                    approval._id,
                    metadata.response.value,
                    metadata.response.respondedBy,
                    metadata.response.timestamp,
                  ),
                );
              }
            }
          }
        }
      }
    } else if (message.role === 'tool') {
      const toolResults = extractToolResults(message.content);
      const age = toolMessageAges?.get(msg._id);
      for (const tr of toolResults) {
        const pendingCall = tr.toolCallId
          ? pendingToolCalls.get(tr.toolCallId)
          : undefined;
        const toolName = tr.toolName ?? pendingCall?.toolName ?? 'unknown_tool';

        result.push(
          fmt.formatToolCallSummary(
            toolName,
            tr.result,
            timestamp,
            tr.isError ? 'error' : 'success',
            age,
          ),
        );

        if (tr.toolCallId) {
          pendingToolCalls.delete(tr.toolCallId);
        }
      }
    } else if (message.role === 'system') {
      const content = extractTextContent(message.content);
      if (content) {
        result.push(fmt.formatSystemMessage(content, timestamp));
      }
    }
  }

  return { historyMessages: result };
}

/**
 * Extract text content from message content (string or array)
 */
function extractTextContent(
  content: string | Array<unknown> | undefined,
): string | undefined {
  if (!content) return undefined;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') {
        textParts.push(part);
      } else if (
        isRecord(part) &&
        part.type === 'text' &&
        typeof part.text === 'string'
      ) {
        textParts.push(part.text);
      }
    }
    return textParts.length > 0 ? textParts.join('\n') : undefined;
  }

  return undefined;
}

/**
 * Extract tool calls from message content
 */
function extractToolCalls(
  content: string | Array<unknown> | undefined,
): ExtractedToolCall[] {
  if (!content || !Array.isArray(content)) return [];

  const toolCalls: ExtractedToolCall[] = [];
  for (const part of content) {
    if (
      isRecord(part) &&
      part.type === 'tool-call' &&
      typeof part.toolName === 'string'
    ) {
      toolCalls.push({
        toolName: part.toolName,
        toolCallId:
          typeof part.toolCallId === 'string' ? part.toolCallId : undefined,
        input: part.args ?? part.input,
      });
    }
  }

  return toolCalls;
}

/**
 * Extract tool results from message content
 */
function extractToolResults(
  content: string | Array<unknown> | undefined,
): ExtractedToolResult[] {
  if (!content || !Array.isArray(content)) return [];

  const results: ExtractedToolResult[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === 'tool-result') {
      results.push({
        toolName: typeof part.toolName === 'string' ? part.toolName : undefined,
        toolCallId:
          typeof part.toolCallId === 'string' ? part.toolCallId : undefined,
        result: part.result ?? part.output,
        isError: part.isError === true,
      });
    }
  }

  return results;
}
