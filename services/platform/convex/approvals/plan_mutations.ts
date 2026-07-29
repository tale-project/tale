import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// `startQueuedTurn` (`convex/threads/message_queue`) moved
// with the rest of the chat pipeline. Approving a plan resumes the agent's
// Claude session to execute it — offline until chat comes back. Validation
// (auth, approval lookup, ownership, thread access) is preserved so the
// error is a proper 404/409-style rejection, not a bare 500; the approval row
// itself is left untouched (still `'pending'`) rather than guessing at a
// terminal status, since neither `'completed'` nor `'rejected'` would be true.

/**
 * Approve a proposed plan (plan/act workflow): one atomic mutation that
 * resolves the approval card, flips the thread to act mode, and starts the
 * execution turn. The act turn re-enters the normal generation pipeline (via
 * the queue machinery's idle path), so it `--resume`s the same Claude session
 * — the plan is already in the agent's context.
 *
 * Offline. See file header.
 */
export const approvePlan = mutation({
  args: {
    approvalId: v.id('approvals'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const approval = await ctx.db.get(args.approvalId);
    if (
      !approval ||
      approval.organizationId !== args.organizationId ||
      approval.resourceType !== 'external_agent_plan' ||
      approval.threadId === undefined
    ) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    const threadId = approval.threadId;
    if (approval.status !== 'pending') {
      // Double-click / stale card — the first call already resolved it.
      throw new ConvexError({ code: 'ALREADY_RESOLVED' });
    }

    const meta = await canAccessThread(
      ctx,
      threadId,
      authUser,
      args.organizationId,
    );
    if (!meta || meta.userId !== authUser.userId) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    throw new ConvexError(
      'Executing an approved plan is offline while the platform AI backend is rewritten.',
    );
  },
});

/** Reject a proposed plan. The thread stays in plan mode — the user keeps
 * iterating by typing (each message is another planning turn). */
export const rejectPlan = mutation({
  args: {
    approvalId: v.id('approvals'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const approval = await ctx.db.get(args.approvalId);
    if (
      !approval ||
      approval.organizationId !== args.organizationId ||
      approval.resourceType !== 'external_agent_plan' ||
      approval.threadId === undefined
    ) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    if (approval.status !== 'pending') {
      throw new ConvexError({ code: 'ALREADY_RESOLVED' });
    }

    const meta = await canAccessThread(
      ctx,
      approval.threadId,
      authUser,
      args.organizationId,
    );
    if (!meta || meta.userId !== authUser.userId) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    await ctx.db.patch(approval._id, {
      status: 'rejected',
      approvedBy: authUser.userId,
      reviewedAt: Date.now(),
    });
    return null;
  },
});
