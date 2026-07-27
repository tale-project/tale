/**
 * The thread trash lifecycle: Delete moves a conversation to Trash
 * (`lifecycleStatus: 'trashed'`), where it waits out the organization's grace
 * window restorable — by its owner here, or by an admin from the governance
 * Trash page — before the retention sweep purges it for good. Purging is the
 * only path that removes rows.
 *
 * Every transition is legal-hold gated and audited. The lifecycle field
 * follows the schema's absent-means-default convention: a live thread has NO
 * `lifecycleStatus`, so restore REMOVES the field rather than writing
 * `'active'` (which the sidebar index walk would read as a different key).
 */

import { v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { loadActiveHolds } from '../governance/legal_hold';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/** Child rows removed per purge call — bounds the mutation. */
const PURGE_PAGE_SIZE = 200;

/**
 * Move a thread to Trash. Owner-gated and hold-gated; refuses while a turn is
 * generating (the turn's writes would land in a trashed thread). Idempotent —
 * trashing a trashed thread reports success. Returns false when the thread is
 * not the caller's.
 */
export const trashThread = mutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return false;
    const thread = await ctx.db.get(threadId);
    if (
      !thread ||
      thread.organizationId !== args.organizationId ||
      thread.userId !== authUser.userId
    ) {
      return false;
    }
    if (thread.lifecycleStatus === 'trashed') return true;
    if (thread.lifecycleStatus !== undefined) return false;

    const generating = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .first();
    if (generating !== null) return false;

    // Throws LEGAL_HOLD_ACTIVE when the org — or this owner, as a custodian —
    // is under an active hold.
    await assertNotHeld(
      ctx,
      args.organizationId,
      'thread',
      String(thread._id),
      undefined,
      thread.userId,
    );

    await ctx.db.patch(thread._id, {
      lifecycleStatus: 'trashed',
      statusChangedAt: Date.now(),
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: authUser.userId,
      actorEmail: authUser.email,
      actorType: 'user',
      action: 'chat_thread.trashed',
      category: 'data',
      resourceType: 'thread',
      resourceId: String(thread._id),
      resourceName: thread.title,
      status: 'success',
    });
    return true;
  },
});

/**
 * The owner's self-restore, for a thread still in the grace window. Only a
 * `'trashed'` thread restores here — an `'expired'` one was aged out by
 * retention policy, and overriding that is the admin Trash page's
 * type-to-confirm flow, not a one-click undo. Restore clears the lifecycle
 * field (never writes `'active'` — see the schema convention).
 */
export const restoreThread = mutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return false;
    const thread = await ctx.db.get(threadId);
    if (
      !thread ||
      thread.organizationId !== args.organizationId ||
      thread.userId !== authUser.userId
    ) {
      return false;
    }
    if (thread.lifecycleStatus !== 'trashed') return false;

    // A hold freezes the trash state in place — restore included, mirroring
    // the admin restore path.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld || holds.userMembershipIds.has(thread.userId)) {
      return false;
    }

    await ctx.db.patch(thread._id, {
      lifecycleStatus: undefined,
      statusChangedAt: Date.now(),
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: authUser.userId,
      actorEmail: authUser.email,
      actorType: 'user',
      action: 'chat_thread.restored_by_user',
      category: 'data',
      resourceType: 'thread',
      resourceId: String(thread._id),
      resourceName: thread.title,
      status: 'success',
    });
    return true;
  },
});

/**
 * Physically remove a thread and everything under it — messages, the
 * generation row, its feedback — page-bounded so one call never exceeds the
 * mutation budget. The caller (the retention sweep) re-invokes until `done`;
 * only the final call removes the thread row itself and writes the audit
 * record. The audit row is the durable trace of the deletion — the thread row
 * leaves no tombstone.
 *
 * Gates re-checked here (the sweep's read is a different transaction):
 * cross-org mismatch skips; an active hold skips; in cutoff mode (grace
 * window disabled) a thread touched since the cutoff skips.
 */
export const purgeThreadInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** Present only in the no-grace mode: re-check content age before
     * cascading, so a thread the user just touched survives TOCTOU. */
    cutoffMs: v.optional(v.number()),
  },
  returns: v.object({ done: v.boolean(), remaining: v.number() }),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return { done: true, remaining: 0 };
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.organizationId !== args.organizationId) {
      return { done: true, remaining: 0 };
    }
    if (args.cutoffMs !== undefined && thread.updatedAt >= args.cutoffMs) {
      return { done: true, remaining: 0 };
    }
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld || holds.userMembershipIds.has(thread.userId)) {
      console.info(
        `[chat] purge of thread ${String(thread._id)} skipped — active legal hold`,
      );
      return { done: true, remaining: 0 };
    }

    let budget = PURGE_PAGE_SIZE;

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .take(budget);
    for (const row of messages) await ctx.db.delete(row._id);
    budget -= messages.length;

    if (budget > 0) {
      const generations = await ctx.db
        .query('generations')
        .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
        .take(budget);
      for (const row of generations) await ctx.db.delete(row._id);
      budget -= generations.length;
    }

    if (budget > 0) {
      const feedback = await ctx.db
        .query('messageFeedback')
        .withIndex('by_threadId', (q) => q.eq('threadId', String(thread._id)))
        .take(budget);
      for (const row of feedback) await ctx.db.delete(row._id);
      budget -= feedback.length;
    }

    if (budget <= 0) {
      return { done: false, remaining: PURGE_PAGE_SIZE - budget };
    }

    await ctx.db.delete(thread._id);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: 'chat_thread.retention_deleted',
      category: 'data',
      resourceType: 'thread',
      resourceId: String(thread._id),
      resourceName: thread.title ?? String(thread._id),
      status: 'success',
    });
    return { done: true, remaining: 0 };
  },
});
