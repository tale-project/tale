import { ConvexError } from 'convex/values';

import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// Audit actions emitted by this file. Keep grep-able so future readers
// can trace lifecycle events end-to-end.
//   chat_thread.archived
//   chat_thread.unarchived

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

  const existing = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  // Round-2 review HIGH: archive without a hold check let a held thread
  // be hidden from the active UI silently — `deleteChatThread` already
  // gated this; this path was missed. Refusal preserves discoverability
  // for compliance review.
  if (existing?.organizationId) {
    await assertNotHeld(
      ctx,
      existing.organizationId,
      'thread',
      threadId,
      undefined,
      existing.userId,
    );
  }

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'archived' },
  });

  if (existing) {
    await ctx.db.patch(existing._id, { status: 'archived' });
    if (existing.organizationId) {
      const identity = await getAuthUserIdentity(ctx);
      await createAuditLog(ctx, {
        organizationId: existing.organizationId,
        actorId: identity?.userId ?? 'system',
        actorEmail: identity?.email,
        actorType: identity ? 'user' : 'system',
        action: 'chat_thread.archived',
        category: 'data',
        resourceType: 'thread',
        resourceId: threadId,
        resourceName: existing.title ?? threadId,
        status: 'success',
      });
    }
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
    const wasArchived = existing.status === 'archived';
    await ctx.db.patch(existing._id, { status: 'active' });
    if (wasArchived && existing.organizationId) {
      const identity = await getAuthUserIdentity(ctx);
      await createAuditLog(ctx, {
        organizationId: existing.organizationId,
        actorId: identity?.userId ?? 'system',
        actorEmail: identity?.email,
        actorType: identity ? 'user' : 'system',
        action: 'chat_thread.unarchived',
        category: 'data',
        resourceType: 'thread',
        resourceId: threadId,
        resourceName: existing.title ?? threadId,
        status: 'success',
      });
    }
  }

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'active' },
  });
}
