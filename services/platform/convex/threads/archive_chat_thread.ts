import { ConvexError } from 'convex/values';

import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';

export async function archiveChatThread(
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
}

export async function unarchiveChatThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (!thread) {
    return;
  }

  const existing = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  if (existing) {
    // Only `'archived'` is reversible via this entry point. Without the
    // guard, a user could un-archive a `'trashed'`/`'expired'`/`'deleted'`
    // thread directly into `'active'`, bypassing the dedicated
    // restoreChatThread mutation (which enforces auth, hold checks,
    // and audit). This is the round-2 backdoor finding.
    if (existing.status !== 'archived' && existing.status !== 'active') {
      throw new ConvexError({
        code: 'UNARCHIVE_NOT_APPLICABLE',
        message:
          `Thread is in '${existing.status}' state — only archived threads ` +
          `can be unarchived. Trashed or expired threads must be restored ` +
          `via restoreChatThread.`,
        currentStatus: existing.status,
      });
    }
    await ctx.db.patch(existing._id, { status: 'active' });
  }

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'active' },
  });
}
