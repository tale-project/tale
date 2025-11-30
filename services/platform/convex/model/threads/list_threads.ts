/**
 * List all active threads for a user.
 */

import { QueryCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export interface Thread {
  _id: string;
  _creationTime: number;
  title?: string;
  status: 'active' | 'archived';
  userId?: string;
}

/**
 * Determine whether a thread should be treated as a general chat thread.
 *
 * We encode chat type in the agent component's `summary` string as JSON:
 * `{ "chatType": "general" | "workflow_assistant" }`.
 * Only threads with an explicit `chatType: "general"` are considered general.
 * Threads without a valid `chatType` field (missing, malformed, or other values)
 * are not treated as general.
 */
function isGeneralThread(summary?: string): boolean {
  if (!summary) return false;

  try {
    const parsed: unknown = JSON.parse(summary);

    if (parsed && typeof parsed === 'object' && 'chatType' in parsed) {
      const chatType = (parsed as { chatType?: unknown }).chatType;
      return chatType === 'general';
    }

    // No explicit chatType field
    return false;
  } catch {
    // Malformed summary
    return false;
  }
}

export async function listThreads(
  ctx: QueryCtx,
  userId: string,
): Promise<Thread[]> {
  const result = await ctx.runQuery(
    components.agent.threads.listThreadsByUserId,
    {
      userId: userId,
      order: 'desc',
      paginationOpts: { cursor: null, numItems: 100 },
    },
  );

  // Filter out archived threads and non-general chat types
  const filtered = result.page.filter(
    (thread) => thread.status === 'active' && isGeneralThread(thread.summary),
  );

  // Map to the public Thread shape so we don't expose internal fields like `summary`
  return filtered.map((thread) => ({
    _id: thread._id,
    _creationTime: thread._creationTime,
    title: thread.title,
    status: thread.status,
    userId: thread.userId,
  }));
}
