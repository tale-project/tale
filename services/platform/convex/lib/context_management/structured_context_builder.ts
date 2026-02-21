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

import type { ActionCtx } from '../../_generated/server';

import { isRecord } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { estimateTokens } from './estimate_tokens';
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
  format: 'single_select' | 'multi_select' | 'text_input' | 'yes_no';
  options?: Array<{
    label: string;
    description?: string;
    value?: string;
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
    typeof val.format === 'string' &&
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
 * Result from building structured context
 */
export interface StructuredContextResult {
  /** Thread context as a string (history, RAG, integrations, etc.) */
  threadContext: string;
  stats: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasRag: boolean;
    hasWebContext: boolean;
    hasIntegrations: boolean;
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
  integrationsInfo?: string;
  maxMessages?: number;
  /** Additional structured context as key-value pairs */
  additionalContext?: Record<string, string>;
  /** Parent thread ID (for sub-agent mode, indicates this is a delegated task) */
  parentThreadId?: string;
}

/**
 * Build a fully structured context window
 *
 * This function:
 * 1. Queries message history from the thread
 * 2. Queries related approvals
 * 3. Formats everything into collapsible <details> sections
 * 4. Returns both the ModelMessage array and the raw text for logging
 */
export async function buildStructuredContext(
  params: BuildStructuredContextParams,
): Promise<StructuredContextResult> {
  const {
    ctx,
    threadId,
    ragContext,
    webContext,
    integrationsInfo,
    maxMessages = 20,
    additionalContext,
    parentThreadId,
  } = params;

  // 1. Query message history
  const messagesResult = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: maxMessages },
    excludeToolMessages: false,
  });

  // 2. Query related approvals for this thread
  const approvals = await ctx.runQuery(
    internal.approvals.internal_queries.getApprovalsForThread,
    { threadId },
  );

  // 3. Build structured context parts
  const contextParts: string[] = [];

  // System info
  contextParts.push(fmt.formatSystemInfo(threadId, Date.now()));

  // Parent thread reference (for sub-agent mode)
  if (parentThreadId) {
    contextParts.push(fmt.formatParentThread(parentThreadId));
  }

  // Note: promptMessage is NOT added here - it's passed via `prompt` parameter.
  // For main chat: user message is already in message history.
  // For sub-agents: task is passed via the `prompt` parameter to generateText().

  // Additional context (key-value pairs as XML sections)
  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      if (value) {
        contextParts.push(fmt.formatAdditionalContext(key, value));
      }
    }
  }

  // Knowledge base (RAG)
  if (ragContext) {
    contextParts.push(fmt.formatKnowledgeBase(ragContext));
  }

  // Web search context
  if (webContext) {
    contextParts.push(fmt.formatWebContext(webContext));
  }

  // Integrations
  if (integrationsInfo) {
    contextParts.push(fmt.formatIntegrations(integrationsInfo));
  }

  // 4. Format messages with approvals interleaved
  // Note: currentUserMessage is NOT included in context - it's passed via `prompt` parameter
  const { historyMessages } = formatMessagesWithApprovals(
    messagesResult.page,
    approvals ?? [],
  );
  if (historyMessages.length > 0) {
    contextParts.push(fmt.formatHistorySection(historyMessages.join('\n\n')));
  }

  // 5. Join all parts
  const contextText = contextParts.join('\n\n');

  // 6. Calculate stats
  const stats = {
    totalTokens: estimateTokens(contextText),
    messageCount: messagesResult.page.length,
    approvalCount: approvals?.length ?? 0,
    hasRag: !!ragContext,
    hasWebContext: !!webContext,
    hasIntegrations: !!integrationsInfo,
  };

  // 7. Return thread context
  return {
    threadContext: contextText,
    stats,
  };
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
): FormattedMessagesResult {
  const result: string[] = [];

  // Create approval lookup by messageId
  const approvalsByMessageId = new Map<string, ApprovalItem[]>();
  for (const approval of approvals) {
    if (approval.messageId) {
      const existing = approvalsByMessageId.get(approval.messageId) ?? [];
      existing.push(approval);
      approvalsByMessageId.set(approval.messageId, existing);
    }
  }

  // Track tool calls to match with results
  const pendingToolCalls = new Map<string, ExtractedToolCall>();

  // Sort messages by order and stepOrder for correct sequencing
  const sortedMessages = [...messages].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.stepOrder - b.stepOrder;
  });

  // Find the last user message (current request, not history)
  let lastUserMsgIndex = -1;
  for (let i = sortedMessages.length - 1; i >= 0; i--) {
    if (sortedMessages[i].message?.role === 'user') {
      lastUserMsgIndex = i;
      break;
    }
  }

  for (let i = 0; i < sortedMessages.length; i++) {
    const msg = sortedMessages[i];
    const timestamp = msg._creationTime;
    const message = msg.message;

    if (!message) continue;

    if (message.role === 'user') {
      const content = extractTextContent(message.content);
      if (content) {
        // Skip the last user message - it's passed via `prompt` parameter, not in context
        if (i !== lastUserMsgIndex) {
          result.push(fmt.formatUserMessage(content, timestamp));
        }
      }
    } else if (message.role === 'assistant') {
      // Assistant message - may contain text and/or tool calls
      const textContent = extractTextContent(message.content);
      if (textContent) {
        result.push(fmt.formatAssistantMessage(textContent, timestamp));
      }

      // Extract tool calls
      const toolCalls = extractToolCalls(message.content);
      for (const tc of toolCalls) {
        if (tc.toolCallId) {
          pendingToolCalls.set(tc.toolCallId, tc);
        }
        // If we have output (inline result), format as summary (non-mimicable format)
        if (tc.output !== undefined) {
          result.push(
            fmt.formatToolCallSummary(
              tc.toolName,
              tc.output,
              timestamp,
              tc.isError ? 'error' : 'success',
            ),
          );
        }
      }

      // Check for human_input_request approvals linked to this message
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
                  metadata.format,
                  metadata.context,
                  metadata.options,
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
      // Tool result message
      const toolResults = extractToolResults(message.content);
      for (const tr of toolResults) {
        // Find matching pending tool call
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
          ),
        );

        // Remove from pending
        if (tr.toolCallId) {
          pendingToolCalls.delete(tr.toolCallId);
        }
      }
    } else if (message.role === 'system') {
      // System message (internal notification)
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
      } else if (isRecord(part)) {
        if (part.type === 'text' && typeof part.text === 'string') {
          textParts.push(part.text);
        }
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
    if (isRecord(part)) {
      if (part.type === 'tool-call' && typeof part.toolName === 'string') {
        toolCalls.push({
          toolName: part.toolName,
          toolCallId:
            typeof part.toolCallId === 'string' ? part.toolCallId : undefined,
          input: part.args ?? part.input,
        });
      }
    }
  }

  return toolCalls;
}

/**
 * Extract tool results from message content
 */
function extractToolResults(
  content: string | Array<unknown> | undefined,
): Array<{
  toolName?: string;
  toolCallId?: string;
  result: unknown;
  isError?: boolean;
}> {
  if (!content || !Array.isArray(content)) return [];

  const results: Array<{
    toolName?: string;
    toolCallId?: string;
    result: unknown;
    isError?: boolean;
  }> = [];

  for (const part of content) {
    if (isRecord(part)) {
      if (part.type === 'tool-result') {
        results.push({
          toolName:
            typeof part.toolName === 'string' ? part.toolName : undefined,
          toolCallId:
            typeof part.toolCallId === 'string' ? part.toolCallId : undefined,
          result: part.result ?? part.output,
          isError: part.isError === true,
        });
      }
    }
  }

  return results;
}
