/**
 * Helper to get the parent thread ID for a sub-thread.
 *
 * Sub-threads store their parent thread ID in their summary field.
 * This allows approval-creating tools to link approvals to the main chat thread
 * instead of the sub-agent's thread.
 */

import { parseJson } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { SubThreadSummary } from '../agent_tools/sub_agents/helpers/types';

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
    const summary = parseJson<Partial<SubThreadSummary>>(thread.summary);
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

/**
 * Get the thread ID that owns the thread workspace (`threadFiles` + the
 * run_code sandbox session).
 *
 * The workspace belongs to the parent CHAT thread: a sub-thread run — a
 * spawned agent job or a delegated sub-agent — reads and writes the same
 * files the parent agent and the user (canvas) see, so a worker's output
 * is visible to the parent and vice versa.
 *
 * @param ctx - Action context for running queries
 * @param currentThreadId - The current thread ID (may be a sub-thread)
 * @returns The thread ID whose workspace file tools should operate on
 */
export async function getWorkspaceThreadId(
  ctx: ActionCtx,
  currentThreadId: string,
): Promise<string> {
  const parentThreadId = await getParentThreadId(ctx, currentThreadId);
  return parentThreadId ?? currentThreadId;
}
