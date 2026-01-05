/**
 * Sub-Thread Management
 *
 * Internal mutations for managing sub-threads used by sub-agents.
 * Sub-threads are stored in the parent thread's summary field for O(1) lookup.
 */

import { internalMutation } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

/** Available sub-agent types */
const subAgentTypeValidator = v.union(
  v.literal('web_assistant'),
  v.literal('document_assistant'),
  v.literal('integration_assistant'),
  v.literal('workflow_assistant'),
);

/** Structure of the subThreads mapping in parent thread summary */
interface SubThreadsMap {
  web_assistant?: string;
  document_assistant?: string;
  integration_assistant?: string;
  workflow_assistant?: string;
}

/** Extended summary structure for threads with sub-thread mappings */
interface ThreadSummaryWithSubThreads {
  chatType?: string;
  subThreads?: SubThreadsMap;
  [key: string]: unknown;
}

/**
 * Atomically get or create a sub-thread for a given parent thread and sub-agent type.
 *
 * This mutation ensures that concurrent requests for the same parent thread and
 * sub-agent type will not create duplicate sub-threads. The read-check-create-update
 * sequence is executed within a single transaction.
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
 */
export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: subAgentTypeValidator,
    userId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { parentThreadId, subAgentType, userId } = args;

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
          `[getOrCreateSubThreadAtomic] Invalid summary JSON in parent thread ${parentThreadId}`,
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
          `[getOrCreateSubThreadAtomic] Reusing existing sub-thread for ${subAgentType}: ${existingSubThreadId}`,
        );
        return { threadId: existingSubThreadId, isNew: false };
      }

      // Sub-thread was archived or deleted, will create a new one
      console.log(
        `[getOrCreateSubThreadAtomic] Sub-thread ${existingSubThreadId} is no longer active, creating new one`,
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
      `[getOrCreateSubThreadAtomic] Created new sub-thread for ${subAgentType}: ${newThread._id}`,
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
  },
});
