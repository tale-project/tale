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
    await ctx.db.patch(existing._id, { title });
  }
}
