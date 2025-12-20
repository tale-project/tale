/**
 * Internal mutation implementation for ActionRetrier onComplete callback.
 *
 * Clears activeRunId on success and saves metadata for the last
 * assistant message in the thread.
 */

import type { MutationCtx } from '../../_generated/server';
import { api, components, internal } from '../../_generated/api';
import type { RunId } from '@convex-dev/action-retrier';
import { listMessages } from '@convex-dev/agent';
import type { GenerateAgentResponseResult } from './generate_agent_response';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

export interface OnChatCompleteArgs {
  runId: RunId;
  result:
    | { type: 'success'; returnValue: GenerateAgentResponseResult }
    | { type: 'failed'; error: string }
    | { type: 'canceled' };
}

export async function onChatComplete(
  ctx: MutationCtx,
  args: OnChatCompleteArgs,
): Promise<null> {
  const { runId, result } = args;

  debugLog('onChatComplete called', {
    runId,
    type: result.type,
  });

  if (result.type === 'success') {
    const chatResult = result.returnValue;
    const { threadId } = chatResult;

    // Clear activeRunId on the thread summary
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });

    if (thread) {
      let summaryData: Record<string, unknown> = { chatType: 'general' };
      if (thread.summary) {
        try {
          summaryData = { chatType: 'general', ...JSON.parse(thread.summary) };
        } catch {
          // Ignore invalid JSON and overwrite
        }
      }

      const { activeRunId: _old, ...rest } = summaryData as {
        activeRunId?: string;
        [key: string]: unknown;
      };

      const updatedSummary = JSON.stringify(rest);

      await ctx.runMutation(components.agent.threads.updateThread, {
        threadId,
        patch: { summary: updatedSummary },
      });
    }

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

      // Find the FIRST ASSISTANT message in this response group.
      // The UI's createAssistantUIMessage groups assistant+tool messages together
      // and uses the first ASSISTANT message's _id as the group's id.
      // Note: order groups ALL messages (including user), but we only want assistant/tool.
      const assistantMessagesInCurrentResponse = sortedMessages
        .filter(
          (msg) =>
            msg.order === currentOrder &&
            (msg.message?.role === 'assistant' || msg.message?.role === 'tool'),
        )
        .sort((a, b) => a._creationTime - b._creationTime);

      // The first message should be an assistant message (not tool) since assistant
      // generates text/tool-call first, then tool results come back
      const firstAssistantMessage = assistantMessagesInCurrentResponse.find(
        (msg) => msg.message?.role === 'assistant',
      );

      if (firstAssistantMessage && chatResult.usage) {
        await ctx.runMutation(api.message_metadata.saveMessageMetadata, {
          messageId: firstAssistantMessage._id,
          threadId: chatResult.threadId,
          model: chatResult.model,
          provider: chatResult.provider,
          inputTokens: chatResult.usage.inputTokens,
          outputTokens: chatResult.usage.outputTokens,
          totalTokens: chatResult.usage.totalTokens,
          reasoningTokens: chatResult.usage.reasoningTokens,
          cachedInputTokens: chatResult.usage.cachedInputTokens,
          reasoning: chatResult.reasoning,
        });
        debugLog('onChatComplete metadata saved', {
          messageId: firstAssistantMessage._id,
          model: chatResult.model,
        });
      }
    }

    // After a successful run, kick off incremental summarization in the
    // background so the next user turn can use an up-to-date summary
    // without paying the summarization cost synchronously.
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.chat_agent.autoSummarizeIfNeeded,
        {
          threadId,
        },
      );
    } catch (error) {
      console.error('[chat_agent] Failed to schedule autoSummarizeIfNeeded', {
        threadId,
        error,
      });
    }
  } else if (result.type === 'failed') {
    console.error('[chat_agent] Generation failed:', result.error);
  } else if (result.type === 'canceled') {
    debugLog('Generation was canceled');
  }

  return null;
}
