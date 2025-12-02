/**
 * Helper for handling context overflow when the agent completes
 * without generating any text. This encapsulates the "no tools"
 * retry path so the main action handler stays focused.
 */

import type { ActionCtx } from '../../_generated/server';
import { components, internal } from '../../_generated/api';
import { listMessages, saveMessage } from '@convex-dev/agent';
import { createChatAgent } from '../../lib/create_chat_agent';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

const MIN_SUMMARY_LENGTH_FOR_RETRY = 50000; // 50k characters
const MAX_NO_TOOL_RETRIES = 5;

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export interface ContextOverflowRetryParams {
  threadId: string;
  promptMessageId: string;
  toolCallCount: number;
  usage?: Usage;
  /**
   * Context object extended with organizationId/threadId/variables,
   * passed through to Agent.generateText.
   */
  contextWithOrg: unknown;
}

export async function handleContextOverflowNoToolRetry(
  ctx: ActionCtx,
  params: ContextOverflowRetryParams,
): Promise<string> {
  const { threadId, promptMessageId, toolCallCount, usage, contextWithOrg } =
    params;

  const tokenInfo = usage
    ? `, tokens: ${usage.inputTokens ?? 0} input / ${
        usage.outputTokens ?? 0
      } output`
    : '';

  debugLog('Forcing summarization before retry check...');

  const forcedSummaryResult: { summarized: boolean; existingSummary?: string } =
    await ctx.runAction(internal.chat_agent.autoSummarizeIfNeeded, {
      threadId,
    });

  const fallbackSummary = forcedSummaryResult.existingSummary || '';
  const summaryLength = fallbackSummary.length;

  if (!fallbackSummary || summaryLength <= MIN_SUMMARY_LENGTH_FOR_RETRY) {
    debugLog(
      `Context overflow detected (${toolCallCount} tool calls${tokenInfo}), but summary not sufficient for retry`,
      { summaryLength, minRequired: MIN_SUMMARY_LENGTH_FOR_RETRY },
    );
    throw new Error(
      'Agent completed without generating a response message. Summary not sufficient for no-tool retry.',
    );
  }

  debugLog(
    `Context overflow detected (${toolCallCount} tool calls${tokenInfo}). Summary is ${summaryLength} chars. Retrying without tools...`,
  );

  // Get the user's original message
  const userMessages = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: 20 },
    excludeToolMessages: true,
  });
  const userMessage = userMessages.page.find((m) => m._id === promptMessageId);
  const userPrompt =
    typeof userMessage?.message?.content === 'string'
      ? userMessage.message.content
      : 'Please provide a response based on our conversation.';

  // Retry up to MAX_NO_TOOL_RETRIES times without tools
  for (let attempt = 1; attempt <= MAX_NO_TOOL_RETRIES; attempt++) {
    debugLog(`No-tool retry attempt ${attempt}/${MAX_NO_TOOL_RETRIES}`);

    const noToolAgent = await createChatAgent({
      withTools: false,
      maxSteps: 1,
    });

    const minimalPrompt = `## Conversation Summary\n\n${fallbackSummary}\n\n---\n\n## User's Current Request\n\n${userPrompt}\n\nPlease respond to the user's request based on the conversation summary above.`;

    try {
      const retryResult = await noToolAgent.generateText(
        contextWithOrg as any,
        { userId: `retry-${threadId}-${attempt}` },
        { prompt: minimalPrompt },
        { storageOptions: { saveMessages: 'none' } },
      );

      const retryText = (retryResult as { text?: string }).text?.trim();
      if (retryText) {
        debugLog(`No-tool retry succeeded on attempt ${attempt}`);
        await saveMessage(ctx, components.agent, {
          threadId,
          message: { role: 'assistant', content: retryText },
        });
        return retryText;
      }

      debugLog(`No-tool retry attempt ${attempt} returned empty`);
    } catch (retryError) {
      debugLog(`No-tool retry attempt ${attempt} failed:`, retryError);
    }
  }

  throw new Error(
    `Agent completed without generating a response message after ${MAX_NO_TOOL_RETRIES} no-tool retries (${toolCallCount} tool calls made${tokenInfo}). Context overflow could not be recovered.`,
  );
}
