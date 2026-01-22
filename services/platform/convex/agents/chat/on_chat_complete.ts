/**
 * Internal mutation called after a routing agent response completes.
 *
 * Saves metadata for the assistant message in the thread
 * and schedules background summarization.
 */

import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { listMessages } from '@convex-dev/agent';

import { createDebugLog } from '../../lib/debug_log';
import { getAutoSummarizeRef } from '../../lib/summarization';
import { getSaveMessageMetadataRef } from '../../lib/agent_completion/function_refs';

const debugLog = createDebugLog('DEBUG_ROUTING_AGENT', '[RoutingAgent]');

/**
 * Result type for onChatComplete mutation.
 * This matches the mutations.ts validator schema.
 * NOTE: This interface is intentionally duplicated here to match the validator schema exactly.
 * Do not import from generate_response.ts as that type has different requirements.
 */
interface ChatCompleteResult {
  threadId: string;
  text: string;
  toolCalls?: Array<{ toolName: string; status: string }>;
  model: string;
  provider: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  subAgentUsage?: Array<{
    toolName: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;
  contextWindow?: string;
  contextStats?: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasSummary: boolean;
    hasRag: boolean;
    hasIntegrations: boolean;
  };
}

export interface OnChatCompleteArgs {
  result: ChatCompleteResult;
}

export async function onChatComplete(
  ctx: MutationCtx,
  args: OnChatCompleteArgs,
): Promise<null> {
  const { result } = args;
  const { threadId } = result;

  debugLog('onChatComplete called', {
    threadId,
    model: result.model,
  });

  // Save metadata for the FIRST assistant message in the current response.
  // The UIMessage component uses the first message's _id as its `id` property
  // (see @convex-dev/agent's createAssistantUIMessage function), so we need
  // to save metadata for that same message for the UI to find it.
  //
  // For multi-step responses with tool calls, there are multiple message docs:
  // - First assistant message (initial text + tool call)
  // - Tool result messages
  // - Final assistant message (text after tool calls)
  // The UI groups these and uses the FIRST message's _id as the group's id.
  const messages = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: 20 },
    excludeToolMessages: false, // Include tool messages to properly identify the response group
  });

  // Find all messages from the current response (same order value as the latest)
  // Messages are grouped by their `order` field in the agent component
  const sortedMessages = messages.page.sort(
    (a, b) => b._creationTime - a._creationTime,
  );

  // Get the order of the latest assistant message
  const latestAssistantMessage = sortedMessages.find(
    (msg) => msg.message?.role === 'assistant',
  );

  // Save metadata if we have an assistant message
  if (latestAssistantMessage) {
    const currentOrder = latestAssistantMessage.order;

    // Find the FIRST message (by stepOrder) in this response group.
    // The UI's createAssistantUIMessage groups assistant+tool messages together
    // and uses the FIRST message's _id (sorted by stepOrder) as the UIMessage.id.
    // This matches the @convex-dev/agent UIMessages.js logic: sorted(groupUnordered)[0]._id
    // Note: order groups ALL messages (including user), but we only want assistant/tool.
    const messagesInCurrentResponse = sortedMessages
      .filter(
        (msg) =>
          msg.order === currentOrder &&
          (msg.message?.role === 'assistant' || msg.message?.role === 'tool'),
      )
      .sort((a, b) => a.stepOrder - b.stepOrder);

    // Get the first message by stepOrder - this matches what UIMessage.id uses
    const firstMessageInResponse = messagesInCurrentResponse[0];

    if (firstMessageInResponse && result.usage) {
      await ctx.runMutation(getSaveMessageMetadataRef(), {
        messageId: firstMessageInResponse._id,
        threadId: result.threadId,
        model: result.model,
        provider: result.provider,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        reasoningTokens: result.usage.reasoningTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        reasoning: result.reasoning,
        durationMs: result.durationMs,
        timeToFirstTokenMs: result.timeToFirstTokenMs,
        subAgentUsage: result.subAgentUsage,
        contextWindow: result.contextWindow,
        contextStats: result.contextStats,
      });
      debugLog('onChatComplete metadata saved', {
        messageId: firstMessageInResponse._id,
        model: result.model,
        hasContextWindow: !!result.contextWindow,
      });
    }
  }

  // After a successful run, kick off incremental summarization in the
  // background so the next user turn can use an up-to-date summary
  // without paying the summarization cost synchronously.
  try {
    await ctx.scheduler.runAfter(0, getAutoSummarizeRef(), { threadId });
  } catch (error) {
    console.error('[chat_agent] Failed to schedule autoSummarizeIfNeeded', {
      threadId,
      error,
    });
  }

  return null;
}
