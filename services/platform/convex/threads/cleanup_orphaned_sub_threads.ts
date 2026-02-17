import type { MutationCtx } from '../_generated/server';

import { components } from '../_generated/api';

export async function cleanupOrphanedSubThreads(
  ctx: MutationCtx,
  parentThreadId: string,
  subThreadIds: string[],
): Promise<{ archivedCount: number }> {
  let archivedCount = 0;

  for (const subThreadId of subThreadIds) {
    const subThread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: subThreadId,
    });

    if (subThread?.status === 'active') {
      await ctx.runMutation(components.agent.threads.updateThread, {
        threadId: subThreadId,
        patch: { status: 'archived' },
      });
      archivedCount++;
    }
  }

  console.log(
    `[cleanupOrphanedSubThreads] Archived ${archivedCount} sub-threads for parent ${parentThreadId}`,
  );

  return { archivedCount };
}
