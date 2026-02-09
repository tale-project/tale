/**
 * Load context summary from a thread.
 *
 * This is a generic utility used by any agent that needs to load
 * an existing conversation summary from the thread.
 */

import type { ActionCtx } from '../../_generated/server';

import { components } from '../../_generated/api';

export async function loadContextSummary(
  ctx: ActionCtx,
  threadId: string,
): Promise<string | undefined> {
  try {
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });

    if (!thread?.summary) {
      return undefined;
    }

    const summaryData = JSON.parse(thread.summary) as {
      contextSummary?: string;
    };
    return typeof summaryData.contextSummary === 'string'
      ? summaryData.contextSummary
      : undefined;
  } catch (error) {
    console.error(
      '[loadContextSummary] Failed to load existing thread summary',
      {
        threadId,
        error,
      },
    );
    return undefined;
  }
}
