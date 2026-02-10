/**
 * Helper to get the parent thread ID for a sub-thread.
 *
 * Sub-threads store their parent thread ID in their summary field.
 * This allows approval-creating tools to link approvals to the main chat thread
 * instead of the sub-agent's thread.
 */

import type { ActionCtx } from '../_generated/server';
import type { SubThreadSummary } from '../agent_tools/sub_agents/helpers/types';

import { components } from '../_generated/api';

/**
 * Get the parent thread ID for a sub-thread from its summary.
 * Returns null if the thread has no parent (is a main thread).
 *
 * @param ctx - Action context for running queries
 * @param threadId - The sub-thread ID to look up
 * @returns The parent thread ID, or null if not a sub-thread
 */
export async function getParentThreadId(
  ctx: ActionCtx,
  threadId: string,
): Promise<string | null> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (!thread?.summary) {
    return null;
  }

  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const summary = JSON.parse(thread.summary) as Partial<SubThreadSummary>;
    return typeof summary.parentThreadId === 'string'
      ? summary.parentThreadId
      : null;
  } catch {
    return null;
  }
}

/**
 * Get the thread ID to use for approvals.
 * Returns the parent thread ID if this is a sub-thread, otherwise returns the current thread ID.
 *
 * @param ctx - Action context for running queries
 * @param currentThreadId - The current thread ID (may be a sub-thread)
 * @returns The thread ID to use for creating approvals
 */
export async function getApprovalThreadId(
  ctx: ActionCtx,
  currentThreadId: string | undefined,
): Promise<string | undefined> {
  if (!currentThreadId) {
    return undefined;
  }

  const parentThreadId = await getParentThreadId(ctx, currentThreadId);
  return parentThreadId ?? currentThreadId;
}
