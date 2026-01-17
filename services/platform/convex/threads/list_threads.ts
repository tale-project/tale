/**
 * List all active threads for a user.
 */

import { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';

export interface Thread {
  _id: string;
  _creationTime: number;
  title?: string;
  status: 'active' | 'archived';
  userId?: string;
}

export interface ListThreadsArgs {
  userId: string;
  search?: string;
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
  args: ListThreadsArgs,
): Promise<Thread[]> {
  const { userId, search } = args;
  const searchLower = search?.trim().toLowerCase();

  const result = await ctx.runQuery(
    components.agent.threads.listThreadsByUserId,
    {
      userId: userId,
      order: 'desc',
      paginationOpts: { cursor: null, numItems: 100 },
    },
  );

  // Filter out archived threads and non-general chat types
  // Also apply search filter if provided
  const filtered = result.page.filter((thread) => {
    // Must be active and general chat type
    if (thread.status !== 'active' || !isGeneralThread(thread.summary)) {
      return false;
    }

    // Apply search filter if provided
    if (searchLower) {
      const title = thread.title?.toLowerCase() ?? '';
      if (!title.includes(searchLower)) {
        return false;
      }
    }

    return true;
  });

  // Map to the public Thread shape so we don't expose internal fields like `summary`
  return filtered.map((thread) => ({
    _id: thread._id,
    _creationTime: thread._creationTime,
    title: thread.title,
    status: thread.status,
    userId: thread.userId,
  }));
}
