/**
 * Get and clear the active runId for a thread.
 *
 * Used to recover chat polling state after a page refresh.
 * The runId is stored in the thread's summary field as JSON: { chatType, activeRunId }.
 */

import { QueryCtx, MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function getActiveRunId(
  ctx: QueryCtx,
  threadId: string,
): Promise<string | null> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (!thread?.summary) {
    return null;
  }

  try {
    const summaryData = JSON.parse(thread.summary);
    return summaryData.activeRunId ?? null;
  } catch {
    // Ignore JSON parse errors
    return null;
  }
}

/**
 * Clear the active runId from a thread's summary.
 */
export async function clearActiveRunId(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (!thread?.summary) {
    return;
  }

  try {
    const summaryData = JSON.parse(thread.summary);
    if (summaryData.activeRunId) {
      delete summaryData.activeRunId;
      await ctx.runMutation(components.agent.threads.updateThread, {
        threadId,
        patch: { summary: JSON.stringify(summaryData) },
      });
    }
  } catch {
    // Ignore JSON parse errors
  }
}
