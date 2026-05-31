import { components } from '../_generated/api';
import { MutationCtx } from '../_generated/server';

export async function updateChatThread(
  ctx: MutationCtx,
  threadId: string,
  title: string,
): Promise<void> {
  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { title },
  });

  const existing = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  if (existing) {
    // Rename is a metadata edit, NOT chat activity — deliberately do NOT bump
    // `updatedAt`. The sidebar derives a thread's relative time and recency
    // ordering from `updatedAt` (which is bumped on generation), so renaming
    // must not reorder the list or change the "Xm ago" label.
    await ctx.db.patch(existing._id, { title });
  }
}
