import type { MutationCtx } from '../_generated/server';
import type { ThreadSummaryWithSubThreads } from '../agent_tools/sub_agents/helpers/types';

import { components, internal } from '../_generated/api';

export async function deleteChatThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'archived' },
  });

  const subThreadIds = parseSubThreadIds(thread?.summary);
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const parsed = JSON.parse(summary) as ThreadSummaryWithSubThreads;
    if (!parsed.subThreads) return [];
    return Object.values(parsed.subThreads).filter(
      (id): id is string => typeof id === 'string',
    );
  } catch {
    return [];
  }
}
