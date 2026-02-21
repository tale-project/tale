import type { MutationCtx } from '../_generated/server';
import type { ThreadSummaryWithSubThreads } from '../agent_tools/sub_agents/helpers/types';

import { parseJson } from '../../lib/utils/type-cast-helpers';
import { components, internal } from '../_generated/api';

export async function deleteChatThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (!thread) {
    return;
  }

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'archived' },
  });

  const existing = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { status: 'archived' });
  }

  const subThreadIds = parseSubThreadIds(thread.summary);
  if (subThreadIds.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.threads.internal_mutations.cleanupOrphanedSubThreads,
      { parentThreadId: threadId, subThreadIds },
    );
  }
}

export function parseSubThreadIds(summary: string | undefined): string[] {
  if (!summary) return [];

  try {
    const parsed = parseJson<ThreadSummaryWithSubThreads>(summary);
    if (!parsed.subThreads) return [];
    return Object.values(parsed.subThreads).filter(
      (id): id is string => typeof id === 'string',
    );
  } catch {
    return [];
  }
}
