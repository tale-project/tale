/**
 * Atomically get or create a sub-thread for a given parent thread and sub-agent type.
 *
 * Sub-threads are stored in the parent thread's summary field for O(1) lookup:
 * ```json
 * {
 *   "chatType": "general",
 *   "subThreads": {
 *     "web_assistant": "thread_id_123",
 *     "document_assistant": "thread_id_456"
 *   }
 * }
 * ```
 */

import { MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';
import type {
  SubAgentType,
  SubThreadSummary,
  ThreadSummaryWithSubThreads,
} from '../agent_tools/sub_agents/helpers/types';

// Re-export for consumers that import from this module
export type { SubAgentType } from '../agent_tools/sub_agents/helpers/types';

/** Result of get or create operation */
export interface GetOrCreateSubThreadResult {
  threadId: string;
  isNew: boolean;
}

/**
 * Atomically get or create a sub-thread for a given parent thread and sub-agent type.
 *
 * This function ensures that concurrent requests for the same parent thread and
 * sub-agent type will not create duplicate sub-threads. The read-check-create-update
 * sequence is executed within a single Convex transaction.
 */
export async function getOrCreateSubThread(
  ctx: MutationCtx,
  parentThreadId: string,
  subAgentType: SubAgentType,
  userId?: string,
): Promise<GetOrCreateSubThreadResult> {
  // 1. Get parent thread to read its summary (atomic read within this transaction)
  const parentThread = await ctx.runQuery(
    components.agent.threads.getThread,
    { threadId: parentThreadId },
  );

  if (!parentThread) {
    throw new Error(`Parent thread not found: ${parentThreadId}`);
  }

  // 2. Parse summary to find existing sub-thread mapping
  let summary: ThreadSummaryWithSubThreads = {};
  if (parentThread.summary) {
    try {
      summary = JSON.parse(
        parentThread.summary,
      ) as ThreadSummaryWithSubThreads;
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
    const subThread = await ctx.runQuery(
      components.agent.threads.getThread,
      { threadId: existingSubThreadId },
    );

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
  // Store parentThreadId in BOTH places:
  // - parentThreadIds: for future use (when Agent SDK exposes this field publicly)
  // - summary: for current use (accessible via public getThread API)
  const subThreadSummary: SubThreadSummary = {
    subAgentType,
    parentThreadId,
  };
  const newThread = await ctx.runMutation(
    components.agent.threads.createThread,
    {
      userId,
      title: `Sub-thread: ${subAgentType}`,
      parentThreadIds: [parentThreadId],
      summary: JSON.stringify(subThreadSummary),
    },
  );

  console.log(
    `[getOrCreateSubThread] Created new sub-thread for ${subAgentType}: ${newThread._id}`,
  );

  // 5. Update parent thread's summary with the new sub-thread mapping (atomic write)
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
