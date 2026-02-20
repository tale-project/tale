/**
 * Helper to get or create a sub-thread for a sub-agent.
 *
 * Sub-threads are stored in the parent thread's summary field for O(1) lookup.
 * This enables thread reuse so sub-agents can maintain conversation context
 * across multiple calls within the same parent thread.
 *
 * This helper delegates to an atomic internal mutation to prevent race conditions
 * when concurrent requests attempt to create sub-threads for the same parent.
 */

import type { ActionCtx } from '../../../_generated/server';
import type { SubAgentKey } from './types';

import { internal } from '../../../_generated/api';

interface GetOrCreateSubThreadArgs {
  parentThreadId: string;
  subAgentType: SubAgentKey;
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
 *     "<partner_root_version_id>": "thread_id_123",
 *     "<another_partner_id>": "thread_id_456"
 *   }
 * }
 * ```
 *
 * When a sub-thread is reused, the Convex Agent SDK automatically loads its message history.
 *
 * This function uses an atomic mutation to ensure that concurrent requests for the same
 * parent thread and sub-agent type will not create duplicate sub-threads.
 */
export async function getOrCreateSubThread(
  ctx: ActionCtx,
  args: GetOrCreateSubThreadArgs,
): Promise<GetOrCreateSubThreadResult> {
  const { parentThreadId, subAgentType, userId } = args;

  // Delegate to atomic internal mutation to prevent race conditions
  // The mutation handles read-check-create-update in a single transaction
  return await ctx.runMutation(
    internal.threads.internal_mutations.getOrCreateSubThreadAtomic,
    {
      parentThreadId,
      subAgentType,
      userId,
    },
  );
}
