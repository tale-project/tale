import { saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { startQueuedTurn } from '../threads/message_queue';

// The act turn's prompt AND its visible user bubble — the transcript honestly
// records what the agent was told. English on purpose: it is agent input.
const APPROVAL_PROMPT = 'Approved — execute the plan.';

/**
 * Approve a proposed plan (plan/act workflow): one atomic mutation that
 * resolves the approval card, flips the thread to act mode, and starts the
 * execution turn. The act turn re-enters the normal generation pipeline (via
 * the queue machinery's idle path), so it `--resume`s the same Claude session
 * — the plan is already in the agent's context.
 *
 * Convex OCC on the threadMetadata row serializes this against
 * markGenerating / queue drains, so the TURN_RUNNING guard has no race window.
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
    if (meta.generationStatus === 'generating') {
      throw new ConvexError({ code: 'TURN_RUNNING' });
    }

    const metadata = isRecord(approval.metadata) ? approval.metadata : {};
    const agentSlug =
      typeof metadata.agentSlug === 'string'
        ? metadata.agentSlug
        : meta.agentSlug;
    if (agentSlug === undefined) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: 'completed',
      approvedBy: authUser.userId,
      reviewedAt: now,
      executedAt: now,
    });
    await ctx.db.patch(meta._id, { externalAgentMode: 'act' });

    // Visible user message = the act turn's prompt (honest transcript), then
    // start the turn through the queue machinery's idle path — identical to
    // enqueueMessage racing past a finalize. Pre-existing queued rows (e.g.
    // rolled back by a Stop) ride along in the same combined turn.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: APPROVAL_PROMPT },
    });
    await ctx.db.insert('chatMessageQueue', {
      organizationId: args.organizationId,
      threadId,
      userId: authUser.userId,
      userEmail: authUser.email ?? '',
      userName: authUser.name ?? '',
      agentSlug,
      messageId,
      text: APPROVAL_PROMPT,
      status: 'queued' as const,
      createdAt: now,
    });
    // Same-transaction read sees the insert; any rows a Stop rolled back ride
    // along in the same combined turn.
    const queued = await ctx.db
      .query('chatMessageQueue')
      .withIndex('by_threadId_status', (q) =>
        q.eq('threadId', threadId).eq('status', 'queued'),
      )
      .collect();
    await startQueuedTurn(ctx, meta, queued);
    return null;
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
