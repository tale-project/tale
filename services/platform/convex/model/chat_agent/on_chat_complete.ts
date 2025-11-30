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

  console.log('[chat_agent] onChatComplete called', {
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

    // Save metadata for the last assistant message, mirroring the original
    // implementation in the monolithic chat_agent.ts.
    const messages = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      excludeToolMessages: true,
    });

    const lastAssistantMessage = messages.page
      .filter((msg) => msg.message?.role === 'assistant')
      .sort((a, b) => b._creationTime - a._creationTime)[0];

    if (lastAssistantMessage && chatResult.usage) {
      await ctx.runMutation(api.message_metadata.saveMessageMetadata, {
        messageId: lastAssistantMessage._id,
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
    console.log('[chat_agent] Generation was canceled');
  }

  return null;
}
