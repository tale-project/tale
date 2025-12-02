'use node';

/**
 * Internal action implementation for generating an agent response.
 *
 * This encapsulates the heavy lifting for generateAgentResponse so the
 * Convex entrypoint file can remain a thin wrapper.
 */

import type { ActionCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { createChatAgent } from '../../lib/create_chat_agent';
import { handleContextOverflowNoToolRetry } from './context_overflow_retry';

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export interface GenerateAgentResponseArgs {
  threadId: string;
  organizationId: string;
  maxSteps: number;
  promptMessageId: string;
}

export interface GenerateAgentResponseResult {
  threadId: string;
  text: string;
  toolCalls?: Array<{ toolName: string; status: string }>;
  model: string;
  provider: string;
  usage?: Usage;
  reasoning?: string;
}

export async function generateAgentResponse(
  ctx: ActionCtx,
  args: GenerateAgentResponseArgs,
): Promise<GenerateAgentResponseResult> {
  const { threadId, organizationId, maxSteps, promptMessageId } = args;

  const TIMEOUT_MS = 9 * 60 * 1000;
  const startTime = Date.now();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(
      `[chat_agent] Aborting request after ${TIMEOUT_MS / 1000}s timeout`,
    );
    abortController.abort();
  }, TIMEOUT_MS);

  try {
    // Load any existing incremental summary for this thread without blocking
    // on a fresh summarization run. Summarization itself is handled
    // asynchronously in onChatComplete and on-demand in the
    // context_overflow_retry flow.
    let contextSummary: string | undefined;
    try {
      const thread = await ctx.runQuery(components.agent.threads.getThread, {
        threadId,
      });

      if (thread?.summary) {
        try {
          const summaryData = JSON.parse(thread.summary) as {
            contextSummary?: string;
          };
          if (typeof summaryData.contextSummary === 'string') {
            contextSummary = summaryData.contextSummary;
          }
        } catch {
          // Ignore malformed summary JSON and proceed without it
        }
      }
    } catch (error) {
      console.error('[chat_agent] Failed to load existing thread summary', {
        threadId,
        error,
      });
    }

    console.log('[chat_agent] Using existing context summary (if any)', {
      threadId,
      hasSummary: !!contextSummary,
    });

    const agent = await createChatAgent({
      withTools: true,
      maxSteps,
    });

    const contextWithOrg = {
      ...ctx,
      organizationId,
      threadId,
      variables: {},
    };

    const contextMessages: Array<{ role: 'user'; content: string }> = [];

    // Always inject threadId so the AI knows which thread to use for context_search
    contextMessages.push({
      role: 'user',
      content: `[SYSTEM] Current thread ID: ${threadId}`,
    });

    if (contextSummary) {
      contextMessages.push({
        role: 'user',
        content: `[CONTEXT] Previous Conversation Summary:\n\n${contextSummary}`,
      });
    }

    const result: { text?: string; steps?: unknown[]; usage?: Usage } =
      await agent.generateText(
        contextWithOrg,
        { threadId },
        {
          promptMessageId,
          abortSignal: abortController.signal,
          messages: contextMessages,
        },
        {
          contextOptions: {
            recentMessages: 20,
            excludeToolMessages: true,
            searchOtherThreads: false,
          },
        },
      );

    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;
    console.log(
      `[chat_agent] generateAgentResponse completed in ${(
        elapsedMs / 1000
      ).toFixed(1)}s for thread ${threadId}`,
    );

    const steps = (result.steps ?? []) as Array<{ [key: string]: any }>;
    const toolCalls = steps
      .filter((step) => step.type === 'tool-call')
      .map((step) => ({
        toolName: String(step.toolName ?? 'unknown'),
        status: String(step.result?.success ? 'completed' : 'failed'),
      }));

    const envModel = (process.env.OPENAI_MODEL || '').trim();
    if (!envModel) {
      throw new Error(
        'OPENAI_MODEL environment variable is required but is not set',
      );
    }

    let responseText = (result.text || '').trim();

    if (!responseText) {
      responseText = await handleContextOverflowNoToolRetry(ctx, {
        threadId,
        promptMessageId,
        toolCallCount: toolCalls.length,
        usage: result.usage,
        contextWithOrg,
      });
    }

    return {
      threadId,
      text: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: envModel,
      provider: 'openai',
      usage: result.usage,
      reasoning: (result as { reasoningText?: string }).reasoningText,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    const elapsedMs = Date.now() - startTime;

    // Log sanitized error details to help diagnose provider issues like
    // AI_APICallError without leaking sensitive request data.
    // NOTE: We only log high-level metadata (status, type, code, message).
    const err = error as any;
    console.error('[chat_agent] generateAgentResponse error', {
      threadId,
      elapsedMs,
      aborted: abortController.signal.aborted,
      name: err?.name,
      message: err?.message,
      status: err?.status ?? err?.statusCode,
      type: err?.type,
      code: err?.code,
      // Capture response body for API errors (helps debug schema issues)
      responseBody: err?.responseBody ?? err?.data ?? err?.cause?.responseBody,
      cause: err?.cause?.message,
    });

    if (abortController.signal.aborted) {
      throw new Error(
        `generateAgentResponse timed out after ${(elapsedMs / 1000).toFixed(
          1,
        )} seconds (limit: ${TIMEOUT_MS / 1000}s)`,
      );
    }

    throw error;
  }
}
