/**
 * Helper to get or create a sub-thread for a sub-agent.
 *
 * Sub-threads are stored in the parent thread's summary field for O(1) lookup.
 * This enables thread reuse so sub-agents can maintain conversation context
 * across multiple calls within the same parent thread.
 */

import type { ActionCtx } from '../../../_generated/server';
import { components } from '../../../_generated/api';
import type { SubAgentType, ThreadSummaryWithSubThreads } from './types';

interface GetOrCreateSubThreadArgs {
  parentThreadId: string;
  subAgentType: SubAgentType;
  userId?: string;
}

interface GetOrCreateSubThreadResult {
  threadId: string;
  isNew: boolean;
}

/**
 * Get an existing sub-thread or create a new one for the given parent thread and sub-agent type.
 *
 * Sub-thread IDs are stored in the parent thread's summary field:
 * ```json
 * {
 *   "chatType": "general",
 *   "subThreads": {
 *     "web_assistant": "thread_id_123",
 *     "document_assistant": "thread_id_456"
 *   }
 * }
 * ```
 *
 * When a sub-thread is reused, the Convex Agent SDK automatically loads its message history.
 */
export async function getOrCreateSubThread(
  ctx: ActionCtx,
  args: GetOrCreateSubThreadArgs,
): Promise<GetOrCreateSubThreadResult> {
  const { parentThreadId, subAgentType, userId } = args;

  // 1. Get parent thread to read its summary
  const parentThread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId: parentThreadId,
  });

  if (!parentThread) {
    throw new Error(`Parent thread not found: ${parentThreadId}`);
  }

  // 2. Parse summary to find existing sub-thread mapping
  let summary: ThreadSummaryWithSubThreads = {};
  if (parentThread.summary) {
    try {
      summary = JSON.parse(parentThread.summary) as ThreadSummaryWithSubThreads;
    } catch {
      // Invalid JSON, start fresh
      console.warn(
        `[getOrCreateSubThread] Invalid summary JSON in parent thread ${parentThreadId}`,
      );
    }
  }

  const existingSubThreadId = summary.subThreads?.[subAgentType];

  // 3. If we have an existing sub-thread ID, verify it's still active
  if (existingSubThreadId) {
    const subThread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: existingSubThreadId,
    });

    if (subThread?.status === 'active') {
      console.log(
        `[getOrCreateSubThread] Reusing existing sub-thread for ${subAgentType}: ${existingSubThreadId}`,
      );
      return { threadId: existingSubThreadId, isNew: false };
    }

    // Sub-thread was archived or deleted, will create a new one
    console.log(
      `[getOrCreateSubThread] Sub-thread ${existingSubThreadId} is no longer active, creating new one`,
    );
  }

  // 4. Create new sub-thread with parentThreadIds for relationship tracking
  const newThread = await ctx.runMutation(
    components.agent.threads.createThread,
    {
      userId,
      title: `Sub-thread: ${subAgentType}`,
      parentThreadIds: [parentThreadId],
    },
  );

  console.log(
    `[getOrCreateSubThread] Created new sub-thread for ${subAgentType}: ${newThread._id}`,
  );

  // 5. Update parent thread's summary with the new sub-thread mapping
  const updatedSummary: ThreadSummaryWithSubThreads = {
    ...summary,
    subThreads: {
      ...summary.subThreads,
      [subAgentType]: newThread._id,
    },
  };

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId: parentThreadId,
    patch: { summary: JSON.stringify(updatedSummary) },
  });

  return { threadId: newThread._id, isNew: true };
}
